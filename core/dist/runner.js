// PHASE-8 T1 — the seat runner: the headless replacement for a pane.
//
// Lifecycle per turn (D1): read unread mail → compose → invoke the harness
// one-shot → capture the raw stream to a turn log → on SUCCESS ack the mail
// (move to cur/) + persist the session id; on failure/timeout the mail
// STAYS in new/ (at-least-once, D11) and the failure is logged honestly.
// One turn at a time per seat by construction. The runner never parses
// meaning from the agent's work — the state machine (events.log) and state
// files stay the coordination truth; the runner is transport + lifecycle.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { deriveBrainRoot } from "./launcher.js";
import { complete, deadLetter, readNew } from "./mailbox.js";
import { gaugeFrom } from "./gui/context.js";
import { buildHeadlessInvocation, composeTurnPrompt, parseSessionId, parseUsage } from "./turn.js";
import { normalizeAgent, resolveHeadlessWall } from "./wall.js";
const DEFAULT_TURN_TIMEOUT_MS = 15 * 60 * 1000;
export function turnsDir(projectRoot, seat) {
    const d = join(projectRoot, ".agents", "state", "turns", seat);
    mkdirSync(d, { recursive: true });
    return d;
}
export function sessionFile(projectRoot, seat) {
    return join(turnsDir(projectRoot, seat), "session.json");
}
/** Native-seat-access (PDR): a live turn's marker — the TTY door refuses to
 * open mid-turn (two doors, one room: never two writers on one session). */
export function activeTurnFile(projectRoot, seat) {
    return join(turnsDir(projectRoot, seat), "active.lock");
}
/** True iff the marker names a LIVE pid — a stale lock (crashed runner) is
 * cleaned up, never treated as busy. isAlive injectable for tests. */
export function isTurnActive(projectRoot, seat, isAlive = pidAlive) {
    const f = activeTurnFile(projectRoot, seat);
    if (!existsSync(f))
        return false;
    try {
        const { pid } = JSON.parse(readFileSync(f, "utf8"));
        if (pid && isAlive(pid))
            return true;
    }
    catch {
        /* unreadable = stale */
    }
    try {
        rmSync(f);
    }
    catch { /* gone already */ }
    return false;
}
export function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** Native-seat-access: the attended marker — a human holds this seat's keys
 * (real TUI open on the seat's session). While it names a live pid the
 * runner does NOT start turns; mail queues and drains on release. */
export function attendedFile(projectRoot, seat) {
    return join(turnsDir(projectRoot, seat), "attended");
}
export function isAttended(projectRoot, seat, isAlive = pidAlive) {
    const f = attendedFile(projectRoot, seat);
    if (!existsSync(f))
        return false;
    try {
        const { pid } = JSON.parse(readFileSync(f, "utf8"));
        if (pid && isAlive(pid))
            return true;
    }
    catch {
        /* unreadable = stale */
    }
    try {
        rmSync(f);
    }
    catch { /* gone already */ }
    return false; // owner died without cleanup — never hold a seat hostage
}
/**
 * True iff this seat already holds a LIVE session for THIS agent — i.e. the
 * binder/docs orientation from a prior turn is still in the model's context,
 * so the next turn can be composed SLIM (speed law, 2026-07-14). Must be
 * checked BEFORE loadSession: pi's pre-mint writes the session file on first
 * load, which would make turn 1 look resumed. A restaffed seat (agent
 * mismatch) or a D12-refreshed seat (file removed) is NOT resumed.
 */
function sessionAlive(projectRoot, seat, agent) {
    const f = sessionFile(projectRoot, seat);
    if (!existsSync(f))
        return false;
    try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        return j.agent === agent && !!j.sessionId;
    }
    catch {
        return false;
    }
}
function loadSession(projectRoot, seat, agent) {
    const f = sessionFile(projectRoot, seat);
    if (!existsSync(f)) {
        // pi CHOOSES its id (T0): mint one up front so every pi turn shares a session.
        if (agent === "pi") {
            const sid = randomUUID();
            writeFileSync(f, JSON.stringify({ agent, sessionId: sid }));
            return sid;
        }
        return undefined;
    }
    try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        return j.agent === agent ? j.sessionId : undefined; // restaffed seat = fresh session
    }
    catch {
        return undefined;
    }
}
/**
 * Acknowledgment / "standing by" chatter that must NOT wake a turn — otherwise
 * two seats ping-pong acks forever after a loop closes (the drive-3 flaw:
 * orchestrator 27 turns / coder 22 for one tiny feature). A message that is
 * ONLY an ack is absorbed (marked read) without invoking the agent; real
 * requests never match this and still wake a turn.
 */
export function isAck(body) {
    return /\b(standing by|no further action|ack(nowledged| processed)|loop closed|no new (testing|action)|already (idle|closed|approved|deployed)|still (idle|standing)|nothing (to do|further)|no action (needed|required))\b/i.test(body);
}
// The wall is rendered ONCE per seat per process (launch-time semantics, like
// the cmux launcher) — not re-read every turn, and not re-rendered between the
// boot note and the first turn (bootWall pre-warms this exact cache). Refusals
// are NOT cached: a throwing resolve re-throws every turn, honestly.
const wallCache = new Map();
function cachedWall(projectRoot, seat, agent) {
    const k = `${projectRoot}|${seat}|${normalizeAgent(agent)}`;
    if (!wallCache.has(k))
        wallCache.set(k, resolveHeadlessWall(projectRoot, seat, agent));
    return wallCache.get(k);
}
/**
 * Resolve + cache a seat's wall AT BOOT (so the first turn reuses it — one
 * render, one bwrap probe) and return the human note. Throws the refusal for a
 * walled-required agent that cannot be walled — the caller reports it in plain
 * words before any turn runs. This is the single boot-time entry for both
 * `crate runner` and `crate team`.
 */
export function bootWall(projectRoot, seat, agent) {
    const w = cachedWall(projectRoot, seat, agent);
    return w ? `walled: ${w.sandbox}/${w.backend}` : "unwalled";
}
/** Process ONE batch of unread mail as one turn. Idle no-op when the box is empty. */
export async function runTurn(opts) {
    const { projectRoot, seat } = opts;
    const agent = normalizeAgent(opts.agent); // one key for the wall AND the adapter dispatch
    const inboxRoot = join(projectRoot, ".agents", "state", "inbox");
    const mail = readNew(inboxRoot, seat);
    if (mail.length === 0)
        return { ok: true, idle: true };
    // Loop-breaker: if EVERY unread message is a pure acknowledgment, absorb
    // them (mark read) WITHOUT a turn. This severs the courtesy-ack ping-pong
    // at the mechanical layer, regardless of what the agent would have replied.
    // NEVER the operator's (W4 dry-run finding #4, 2026-07-13): a human
    // directive ending in "…hold nothing further" matched the ack regex and was
    // silently swallowed — the operator's one input must ALWAYS wake a turn;
    // the loop-breaker exists for seat-to-seat chatter only.
    if (mail.every((m) => m.from !== "operator" && isAck(m.body))) {
        complete(inboxRoot, seat, mail);
        appendFileSync(join(turnsDir(projectRoot, seat), "turns.log"), `${new Date().toISOString()} | absorbed | ${mail.length} ack(s), no turn\n`);
        return { ok: true, idle: true };
    }
    const resumed = sessionAlive(projectRoot, seat, agent); // BEFORE loadSession's pi pre-mint
    const prompt = composeTurnPrompt(projectRoot, seat, mail, { resumed });
    const sessionId = loadSession(projectRoot, seat, agent);
    // T6: a real turn launches inside the seat's declared wall (Seatbelt/bwrap
    // via the D7 seam). A walled-required agent that cannot be walled THROWS
    // here — the refusal is a boot/turn failure, never a silent unwalled run.
    // An invocationOverride (tests) replaces the harness itself, so no wall.
    let inv;
    // CRATE_WALLED (FLAWS "browser-tooling"): a walled turn stamps the child
    // env so in-box tools KNOW they run inside a wall — the agent-browser shim
    // keys chromium's --no-sandbox injection off it (the OS refuses a nested
    // sandbox init, so the outer wall must be the containment). The launcher's
    // cmux scripts export the same marker; this covers the headless door on
    // BOTH backends (Seatbelt and bwrap — bwrap passes env through, no
    // --clearenv in renderBwrapArgs).
    let walled = false;
    if (opts.invocationOverride) {
        inv = opts.invocationOverride(prompt, sessionId);
    }
    else {
        const wall = cachedWall(projectRoot, seat, agent);
        walled = wall !== undefined;
        inv = buildHeadlessInvocation(agent, { prompt, sessionId, model: opts.model, walled });
        if (wall)
            inv.argv = [...wall.argvPrefix, ...inv.argv];
    }
    const startedAt = new Date();
    // Handoff-latency instrumentation (speed law): oldest unread mail's enqueue
    // epoch (the maildir filename prefix) → turn start. Proves wake latency and
    // catches regressions; the model's own time is durationMs, never this.
    const oldestMs = Math.min(...mail.map((m) => Number(m.name.split("-")[0] ?? NaN)).filter((n) => Number.isFinite(n)));
    const waitMs = Number.isFinite(oldestMs) ? Math.max(0, startedAt.getTime() - oldestMs) : undefined;
    const logPath = join(turnsDir(projectRoot, seat), `${startedAt.toISOString().replaceAll(":", "-")}.jsonl`);
    // Native-seat-access: mark the turn live for its duration so the TTY door
    // refuses to open mid-turn (two doors, never two writers on one session).
    writeFileSync(activeTurnFile(projectRoot, seat), JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString() }));
    let result;
    try {
        result = await execTurn(inv, projectRoot, logPath, agent, opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS, { ...seatEnv(projectRoot, seat), ...(walled ? { CRATE_WALLED: "1" } : {}) });
    }
    finally {
        try {
            rmSync(activeTurnFile(projectRoot, seat));
        }
        catch { /* stale-lock cleanup covers a miss */ }
    }
    const meta = {
        turnMeta: true, seat, agent, ok: result.ok, mail: mail.length,
        startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(),
        ...(waitMs !== undefined ? { waitMs } : {}), resumed,
        usage: result.usage ?? null, sessionId: result.sessionId ?? sessionId ?? null,
        ...(result.error ? { error: result.error } : {}),
    };
    appendFileSync(logPath, JSON.stringify(meta) + "\n");
    appendFileSync(join(turnsDir(projectRoot, seat), "turns.log"), `${meta.startedAt} | ${meta.ok ? "ok" : "FAILED"} | mail=${meta.mail} | ${meta.durationMs}ms | in=${meta.usage?.inputTokens ?? "?"} out=${meta.usage?.outputTokens ?? "?"}${waitMs !== undefined ? ` | wait=${waitMs}ms` : ""}${resumed ? "" : " | oriented"}${result.error ? ` | ${result.error}` : ""}\n`);
    if (result.ok) {
        complete(inboxRoot, seat, mail); // ack ONLY after a finished turn (at-least-once)
        const sid = result.sessionId ?? sessionId;
        if (sid)
            writeFileSync(sessionFile(projectRoot, seat), JSON.stringify({ agent, sessionId: sid }));
        return { ok: true, sessionId: sid, usage: result.usage, logPath };
    }
    return { ok: false, usage: result.usage, logPath, error: result.error };
}
/** P3-1 parity, headless (W4 finding #2, 2026-07-13): first-choice tools
 * (qa-sweep, agent-browser, axe-check, rg, …) resolve by NAME inside every
 * seat. The cmux launcher exported `<brain>/core/tools` on the pane's PATH;
 * the headless runner inherited nothing — the QA seat reported its in-box
 * tools "not installed" and self-graded partial. Composed per turn (cheap,
 * and correct across engine updates). A rig without .agents/bin (test
 * fixtures) falls back to the plain env — the tools shim needs a brain. */
export function seatEnv(projectRoot, seat) {
    // DISABLE_AUTOUPDATER (Adam, 2026-08-11): claude's self-update writes its
    // own binaries in $HOME — the wall correctly DENIES that, so every wheeled
    // session nagged "Auto-update failed · run claude doctor". Updating the
    // harness is a deliberate outside-the-wall act; inside a seat the updater
    // stays off and the nag disappears.
    //
    // CRATE_SEAT (emit-identity fix, 2026-08-11; FLAWS "emit identity is
    // self-declared"): stamp the seat's TRUE identity into every child the
    // runner spawns. agentctl's `--actor` was pure self-declaration — a live
    // coder re-emitted `gate_release --actor operator` and passed. agentctl now
    // refuses operator-only claims when CRATE_SEAT names a seat. The stamp
    // rides BOTH doors deliberately: the headless turn AND the wheel/TTY
    // (ptyseat) — a TTY session IS the seat's session, so even an operator
    // driving the wheel cannot release the gate from inside it (the release
    // paths are the GUI gate card or the operator's own terminal, both
    // CRATE_SEAT-free). Set AFTER the process.env spread so an inherited
    // CRATE_SEAT (engine-nested-in-a-seat) is OVERWRITTEN, never leaked.
    try {
        const tools = join(deriveBrainRoot(projectRoot), "core", "tools");
        return { ...process.env, PATH: `${tools}:${process.env.PATH ?? ""}`, DISABLE_AUTOUPDATER: "1", CRATE_SEAT: seat };
    }
    catch {
        return { ...process.env, DISABLE_AUTOUPDATER: "1", CRATE_SEAT: seat };
    }
}
function execTurn(inv, cwd, logPath, agent, timeoutMs, env) {
    return new Promise((resolve) => {
        const child = spawn(inv.argv[0], inv.argv.slice(1), {
            cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true, // own pgid → group-kill on timeout
        });
        let sessionId;
        let usage;
        let buf = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                process.kill(-child.pid, "SIGKILL");
            }
            catch { /* already gone */ }
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            buf += chunk.toString();
            let nl;
            while ((nl = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                appendFileSync(logPath, line + "\n"); // raw stream, verbatim
                sessionId = parseSessionId(agent, line) ?? sessionId;
                usage = parseUsage(agent, line) ?? usage;
            }
        });
        child.stderr.on("data", (chunk) => appendFileSync(logPath, JSON.stringify({ stderr: chunk.toString() }) + "\n"));
        child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut)
                resolve({ ok: false, usage, error: `turn timeout after ${timeoutMs}ms (killed)` });
            else if (code === 0)
                resolve({ ok: true, sessionId, usage });
            else
                resolve({ ok: false, usage, error: `harness exited ${code}` });
        });
        child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e) }); });
    });
}
/** The seat's standing loop: watch → turn → ack/retry → watch. */
export async function runnerLoop(opts) {
    const pollMs = opts.pollMs ?? 1000;
    const maxRetries = opts.maxRetries ?? 3;
    const inboxRoot = join(opts.projectRoot, ".agents", "state", "inbox");
    const failures = new Map(); // message name → consecutive failures
    // PHASE-B #1: the orphan watchdog. A runner is a child of its supervisor
    // (the GUI server or `crate team`); when the supervisor dies the OS reparents
    // the runner and ppid changes — the runner must EXIT, not keep burning turns
    // for a dead cockpit (testuser8 run: the server crashed silently and every
    // seat kept working, invisible, until a sudo pkill).
    const getPpid = opts.getParentPid ?? (() => process.ppid);
    // Runner-deaths fix (FLAWS 2026-08-11): prefer the pid the SPAWNER handed us
    // over a self-captured ppid. We only reach this line ~1-3s after spawn (node
    // startup + bootWall's wall render + bwrap probe run first); a supervisor
    // dying inside that window meant ppid0 captured the REPARENTED parent (init)
    // and the `!==` below could never fire — the immortal orphan that survived
    // the battle-test relaunch. With supervisorPid fixed before we even started,
    // a mid-boot reparent is caught on the very first loop iteration.
    const ppid0 = opts.supervisorPid ?? getPpid();
    // Event-driven wake (speed law, 2026-07-14): fs.watch on the seat's maildir
    // new/ fires the INSTANT a .msg lands (the tmp+rename enqueue is atomic, so
    // a watcher never sees a half-written file). The pollMs sleep stays as the
    // fallback heartbeat — a missed event costs at most one poll interval, and
    // the orphan watchdog still ticks every wake.
    const newDir = join(inboxRoot, opts.seat, "new");
    mkdirSync(newDir, { recursive: true });
    let kick;
    let watcher;
    try {
        watcher = watch(newDir, () => kick?.());
        watcher.on("error", () => { });
    }
    catch {
        /* watch unavailable on this fs — pure polling still works */
    }
    const idleWait = () => new Promise((res) => {
        const done = () => {
            kick = undefined;
            clearTimeout(t);
            opts.signal?.removeEventListener("abort", done);
            res();
        };
        const t = setTimeout(done, pollMs);
        kick = done;
        opts.signal?.addEventListener("abort", done, { once: true }); // stop is instant, never poll-bounded
    });
    let heldNoted = false; // one log line per hold, not one per poll
    try {
        while (!opts.signal?.aborted) {
            // Native-seat-access: a human holds the keys — the runner idles (mail
            // queues, nothing is lost) until the TUI door closes.
            if (isAttended(opts.projectRoot, opts.seat)) {
                if (!heldNoted) {
                    heldNoted = true;
                    appendFileSync(join(turnsDir(opts.projectRoot, opts.seat), "turns.log"), `${new Date().toISOString()} | held — operator has the keys (native TUI); turns resume on release\n`);
                }
                await idleWait();
                continue;
            }
            heldNoted = false;
            if (getPpid() !== ppid0) {
                try {
                    appendFileSync(join(turnsDir(opts.projectRoot, opts.seat), "turns.log"), `${new Date().toISOString()} | orphaned — supervisor (pid ${ppid0}) is gone; runner exiting\n`);
                }
                catch { /* the exit matters more than the note */ }
                // Runner-deaths fix (FLAWS 2026-08-11): SELF-stamp the forensic trail.
                // The parent-side EXIT handler (teamproc) lives in the supervisor — and
                // on this path the supervisor is DEAD, so nobody else is left to write
                // the record; that's exactly how five watchdog deaths left zero EXIT
                // lines and zero gui.log lines during the battle-test relaunch.
                const home = opts.home ?? process.env.HOME;
                if (home) {
                    const stamp = `[${new Date().toISOString()}] runner ${opts.seat} orphan-exit — supervisor ${ppid0} gone\n`;
                    try {
                        const p = join(home, ".crate", "logs", "runners", `${opts.seat}.log`);
                        mkdirSync(join(home, ".crate", "logs", "runners"), { recursive: true });
                        appendFileSync(p, stamp);
                    }
                    catch { /* forensics only */ }
                    try {
                        appendFileSync(join(home, ".crate", "logs", "gui.log"), stamp);
                    }
                    catch { /* forensics only */ }
                }
                return;
            }
            const r = await (opts.runTurnImpl ?? runTurn)(opts);
            // D12 auto-refresh: a completed turn just wrote fresh state, so dropping
            // the session here is lossless. Only when opted-in AND over the ceiling.
            if (opts.contextAutoRefresh && r.ok && !r.idle && r.usage) {
                const g = gaugeFrom(r.usage.inputTokens, opts.model);
                if (g?.band === "high") {
                    const sf = sessionFile(opts.projectRoot, opts.seat);
                    if (existsSync(sf))
                        rmSync(sf);
                    appendFileSync(join(turnsDir(opts.projectRoot, opts.seat), "turns.log"), `${new Date().toISOString()} | auto-refreshed | context ${Math.round(g.pct * 100)}% ≥ ceiling — session dropped\n`);
                }
            }
            if (r.idle) {
                await idleWait();
                continue;
            }
            if (!r.ok) {
                for (const m of readNew(inboxRoot, opts.seat)) {
                    const n = (failures.get(m.name) ?? 0) + 1;
                    failures.set(m.name, n);
                    if (n >= maxRetries) {
                        deadLetter(inboxRoot, opts.seat, m, `turn failed ${n}x: ${r.error ?? "unknown"}`);
                        failures.delete(m.name);
                    }
                }
                await new Promise((res) => setTimeout(res, pollMs * 2)); // backoff, never hot-loop
            }
        }
    }
    finally {
        watcher?.close();
    }
}
//# sourceMappingURL=runner.js.map