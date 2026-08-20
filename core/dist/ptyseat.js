// Native seat access (PDR native-seat-access, 2026-08-10) — the second door.
//
// Autonomous turns drive a seat through the headless machine channel
// (runner.ts). This module opens the OTHER door on the SAME session: the
// agent's real interactive TUI (claude/codex/pi) in a server-side PTY,
// spawned inside the seat's identical wall, streamed to the ⚡ window.
// While a TTY is open the seat is "attended" (runner holds turns; mail
// queues); on exit the hold releases and — for claude, whose interactive
// resume forks a NEW session id — the seat's session file is re-pointed at
// the fork so the next headless turn remembers what the human did.
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { localIsoOffset } from "./mailbox.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { attendedFile, isTurnActive, seatEnv, sessionFile, turnsDir, } from "./runner.js";
import { normalizeAgent, resolveHeadlessWall } from "./wall.js";
/** The interactive (TUI) argv for one agent — the same session the headless
 * door resumes, opened the way the CLI was built to be used. Permission
 * posture (REVISED by Adam, 2026-08-11, after real driving): a WALLED wheel
 * bypasses claude's own approvals, same as the headless seats — approving
 * every edit was pure friction when the wall already cages all writes to
 * the project + doors. No wall → no bypass, same law as everywhere. */
/** The identity a wheel session is born with — who it is, where its laws
 * live, and the one law that must survive even a human conversation. */
export function seatIdentityPrompt(seat) {
    const base = `You are the ${seat || "(unstaffed)"} seat of this project's Crate Engine rig — a five-seat AI dev team ` +
        `(orchestrator, coder, reviewer, designer, tester/QA) coordinated through .agents/. Your role binder is ` +
        `.agents/config/${seat}.md — read it before acting on team matters; its laws bind this session too. ` +
        `Team coordination happens via python3 .agents/bin/agentctl.py (emit transitions, deliver mail) — never by you ` +
        `doing another seat's job.`;
    if (seat === "orchestrator") {
        return (base +
            ` THE ORCHESTRATOR LAW HOLDS AT THE WHEEL: you coordinate, you NEVER produce the work yourself. When the ` +
            `operator asks for a feature or fix, dispatch it — emit start_impl and deliver a complete brief to the coder ` +
            `via agentctl — do not write the code, tests, or designs in this session.`);
    }
    return base;
}
export function buildInteractiveInvocation(agentArg, opts = {}) {
    const agent = normalizeAgent(agentArg);
    const { sessionId, model } = opts;
    switch (agent) {
        case "claude": {
            // Seat identity (flaw #9, Adam's first loop kickoff, 2026-08-11): a
            // wheel session opened as RAW claude — no binder, no role — so the
            // "orchestrator" cheerfully built the feature itself instead of
            // dispatching the team. Every wheel now carries its seat's identity.
            const argv = ["claude"];
            if (opts.seat)
                argv.push("--append-system-prompt", seatIdentityPrompt(opts.seat));
            if (opts.walled)
                argv.push("--permission-mode", "bypassPermissions");
            if (model)
                argv.push("--model", model);
            if (sessionId)
                argv.push("--resume", sessionId);
            return argv;
        }
        case "codex": {
            // resume-first (T0: `codex resume <thread>` continues the thread the
            // headless turns built). Model only when staffed non-empty — the codex
            // catalog entry deliberately rides the account default.
            //
            // CE-153: WALLED-ONLY approvals bypass, the same posture claude and agy
            // hold here and the same one `turn.ts` already gave codex headlessly
            // (`codex exec --dangerously-bypass-approvals-and-sandbox`). The catalog
            // row has always PROMISED it — "Codex's own approvals bypassed within it,
            // same posture as Claude" — but the promise lived on the path that stopped
            // being the one that runs when seats went blended. Adam's ruling
            // 2026-08-18 makes bypass-inside-the-wall the standing posture for every
            // blended seat rather than a per-harness call; the wall is what makes it
            // safe, and the gate below is what keeps the P8 law (never on a bare host).
            //
            // Placement is checked, not assumed: `codex resume --help` lists the flag
            // among the SUBCOMMAND's own options, so it goes right after `resume` and
            // ahead of the session id — appending it after the id could be read as
            // resume's trailing [PROMPT] positional.
            const argv = ["codex"];
            if (sessionId)
                argv.push("resume");
            if (opts.walled)
                argv.push("--dangerously-bypass-approvals-and-sandbox");
            if (sessionId)
                argv.push(sessionId);
            if (model)
                argv.push("--model", model);
            return argv;
        }
        case "agy": {
            // The interactive door. NOTE the print-mode trap this deliberately
            // avoids: `agy -p` treats writes as "artifacts" under its own scratch
            // dir and needs --add-dir to touch the project at all, reporting SUCCESS
            // either way. Interactive agy works on the trusted project directory
            // directly, so the blended path never meets that failure.
            // Resume rides --conversation <id> (proven: num_turns 2, correct recall).
            const argv = ["agy"];
            // CE-152 (battle test 2026-08-18, rung B4): WALLED-ONLY, exactly as the
            // claude case above and the headless turn wire (turn.ts) already do.
            // Without it an agy seat stops on its own approval modal at the FIRST
            // thing it is asked to do — read its role binder, which lives behind the
            // .agents/config symlink and so reads as "outside workspace" — and the
            // modal renders into a pane nobody can answer while the engine reports the
            // seat live. The flag is global in agy (not print-mode), and the seat is
            // genuinely walled (resolveHeadlessWall returns a seatbelt plan for agy),
            // so the P8 posture is unchanged: approvals are bypassed only inside a
            // rendered wall, never on a bare host.
            if (opts.walled)
                argv.push("--dangerously-skip-permissions");
            if (model)
                argv.push("--model", model);
            if (sessionId)
                argv.push("--conversation", sessionId);
            return argv;
        }
        case "pi": {
            const argv = ["pi"];
            if (model) {
                argv.push("--provider", model.split("/")[0], "--model", model.split("/").slice(1).join("/"));
            }
            if (sessionId)
                argv.push("--session-id", sessionId);
            return argv;
        }
        default:
            throw new Error(`the ${agent} seat has no interactive door yet — claude/codex/pi/agy only; ` +
                `the pattern extends once the wired seats earn battle-testing.`);
    }
}
/** The seat's session id as the TTY door should open it. Mirrors the
 * runner's semantics (pi pre-mints so both doors share one session). */
export function ttySessionId(projectRoot, seat, agentArg) {
    const agent = normalizeAgent(agentArg);
    const f = sessionFile(projectRoot, seat);
    if (existsSync(f)) {
        try {
            const j = JSON.parse(readFileSync(f, "utf8"));
            if (j.agent === agent && j.sessionId)
                return j.sessionId;
        }
        catch {
            /* unreadable = fresh */
        }
    }
    if (agent === "pi") {
        const sid = randomUUID();
        writeFileSync(f, JSON.stringify({ agent, sessionId: sid }));
        return sid;
    }
    return undefined;
}
/** Does this seat have a session a spawn would RESUME (CE-014)?
 *
 * Mirrors ttySessionId's acceptance rule — the file exists and names a session
 * for THIS agent — but is deliberately side-effect free: ttySessionId MINTS an
 * id for pi, which would make a fresh seat report as resumable and hand a
 * clean-eyes worker the previous task's scrollback. */
export function hasResumableSession(projectRoot, seat, agentArg) {
    const agent = normalizeAgent(agentArg);
    try {
        const j = JSON.parse(readFileSync(sessionFile(projectRoot, seat), "utf8"));
        return j.agent === agent && !!j.sessionId;
    }
    catch {
        return false; // absent or unreadable = fresh
    }
}
/** Claude Code stores sessions per munged-cwd: non-alphanumerics become "-"
 * (verified against a live ~/.claude/projects). */
export function claudeProjectDir(projectRoot, home) {
    return join(home, ".claude", "projects", projectRoot.replace(/[^a-zA-Z0-9]/g, "-"));
}
/** Newest session file (basename sans .jsonl) touched at/after sinceMs. */
export function newestClaudeSession(dir, sinceMs) {
    let best;
    let bestM = 0;
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return undefined;
    }
    for (const f of names) {
        if (!f.endsWith(".jsonl"))
            continue;
        try {
            const m = statSync(join(dir, f)).mtimeMs;
            if (m >= sinceMs && m > bestM) {
                bestM = m;
                best = f.slice(0, -".jsonl".length);
            }
        }
        catch {
            /* raced a deletion */
        }
    }
    return best;
}
/**
 * The handback seam: after a claude TUI closes, point the seat's session
 * file at the session the human actually drove (interactive resume FORKS a
 * new id — without this, the next headless turn would resume the pre-drop-in
 * memory and lose everything the human did). Falls back to scanning every
 * claude project dir when the munged dir yields nothing (belt + braces on
 * the munge rule). No-op for codex/pi (ids observed stable across doors —
 * live-confirm rides the first battle-test drop-in).
 */
export function repointSessionAfterTty(projectRoot, seat, agentArg, sinceMs, home = homedir()) {
    const agent = normalizeAgent(agentArg);
    if (agent !== "claude")
        return undefined;
    let root = projectRoot;
    try {
        root = realpathSync(projectRoot);
    }
    catch {
        /* keep as given */
    }
    let sid = newestClaudeSession(claudeProjectDir(root, home), sinceMs);
    if (!sid) {
        const base = join(home, ".claude", "projects");
        try {
            for (const d of readdirSync(base)) {
                const cand = newestClaudeSession(join(base, d), sinceMs);
                if (cand)
                    sid = cand; // any project dir — newest wins across the scan
            }
        }
        catch {
            /* no claude home = nothing to re-point */
        }
    }
    if (!sid)
        return undefined;
    const f = sessionFile(projectRoot, seat);
    let prev;
    try {
        prev = JSON.parse(readFileSync(f, "utf8")).sessionId;
    }
    catch {
        /* fresh */
    }
    if (sid === prev)
        return undefined;
    writeFileSync(f, JSON.stringify({ agent, sessionId: sid }));
    return sid;
}
/** Blended-pane (PDR blended-pane, S1): the quiet-composer gate is pure
 * keystroke-timestamp inference — write() is the ONE human chokepoint (web
 * cockpit xterm → POST /api/tty/input → here), so no screen parsing is ever
 * needed. composerDirty tracks a likely half-typed draft: printable bytes set
 * it; CR/Ctrl+C/Esc clear it (submit/cancel empties the composer). CSI
 * sequences (arrow keys etc.) are stripped first — cursor movement is not
 * typing, and counting the 'A' of ESC[A as a draft would demand the long
 * quiet for every arrow press. */
export function updateComposerDirty(prev, data) {
    const text = data.toString("latin1").replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "\x1b");
    let dirty = prev;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x0d || c === 0x0a || c === 0x03 || c === 0x1b)
            dirty = false;
        else if (c >= 0x20 && c !== 0x7f)
            dirty = true;
    }
    return dirty;
}
/** Blended pi seats crash under old system node (live probe, superman
 * 2026-08-12: pi 0.84.1 + node v20 dies at import — undici
 * markAsUncloneable TypeError; works under node >= 22). Pick the newest
 * nvm-installed node >= 22 so the spawn env can prepend its bin. Pure over
 * an injected version list. */
export function pickPiNodeVersion(versions) {
    let best;
    let bestKey = [];
    for (const v of versions) {
        const m = v.match(/^v(\d+)\.(\d+)\.(\d+)$/);
        if (!m)
            continue;
        const key = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (key[0] < 22)
            continue;
        if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
            best = v;
            bestKey = key;
        }
    }
    return best;
}
function piNodeBinDir(home) {
    const base = join(home, ".nvm", "versions", "node");
    try {
        const v = pickPiNodeVersion(readdirSync(base));
        return v ? join(base, v, "bin") : undefined;
    }
    catch {
        return undefined; // no nvm — the system node carries it (or pi refuses honestly)
    }
}
// Backlog 14 (Adam's verify, 2026-08-14): the SESSION owns its history, the
// window is just a view — Ghostty's model, what cmux gives the same TUIs.
// 256K held barely a screen of claude repaint traffic, so a fresh attach had
// nothing to scroll INTO and the slider filled the lane. 2M ≈ the client's
// 5000-line scrollback with ANSI overhead; replay is a one-time cost per
// attach, not standing chatter (the storm law is untouched).
const REPLAY_CAP = 2 * 1024 * 1024;
// ── PANE REHYDRATION (CE-014, Adam 2026-08-17) ───────────────────────────────
// "Close the app, open it again, my sessions come back" — cmux's contract.
//
// The CONVERSATION already came back: turns/<seat>/session.json holds the seat's
// session id and startSeatTty resumes it (`claude --resume`, `codex exec resume`,
// pi's pre-minted id). What did NOT come back was the pane's SCROLLBACK — the
// replay ring lived only in this process's memory, so a rehydrated seat opened
// visually blank and read as a lost session even though the agent remembered
// everything. That gap is the whole of this block.
//
// So the ring is mirrored to turns/<seat>/pane.raw and read back when a spawn
// RESUMES a session. Three things make it safe rather than clever:
//
//  1. FRESH MEANS FRESH. If the spawn is not resuming (fresh-per-task worker,
//     the D12 refresh, a dropped session.json), the pane file is DELETED. A
//     clean-eyes seat showing the previous task's scrollback would be worse than
//     a blank pane — it is the exact confusion fresh-per-task exists to remove.
//  2. AMORTIZED WRITES. Appends are small and frequent; a trim rewrite happens
//     only when the file passes 2x the cap, so the cost is one rewrite per
//     REPLAY_CAP bytes of output, not per chunk.
//  3. NEVER FATAL. Every disk touch here is best-effort. A pane that cannot
//     persist its scrollback still works; losing the mirror costs history, and
//     wedging the PTY over history would be a far worse trade.
const PANE_FILE = "pane.raw";
const paneFile = (projectRoot, seat) => join(turnsDir(projectRoot, seat), PANE_FILE);
/** The persisted scrollback, tail-capped, or empty when there is none. */
export function readPaneHistory(projectRoot, seat, cap = REPLAY_CAP) {
    try {
        const b = readFileSync(paneFile(projectRoot, seat));
        return b.length > cap ? b.subarray(b.length - cap) : b;
    }
    catch {
        return Buffer.alloc(0);
    }
}
export function dropPaneHistory(projectRoot, seat) {
    try {
        rmSync(paneFile(projectRoot, seat));
    }
    catch {
        /* absent already */
    }
}
/** A visible seam between what a previous engine process showed and what this
 * one is showing. Silence here would leave the operator unable to tell restored
 * history from live output — and mistaking old output for current is exactly
 * the class of error the redelivery header exists to prevent. */
export function paneResumeBanner(atIso) {
    return Buffer.from(`\r\n\x1b[2m── session restored ${atIso} — history above is from before the engine restarted ──\x1b[0m\r\n`, "utf8");
}
const registry = new Map();
const keyOf = (projectRoot, seat) => `${projectRoot}|${seat}`;
export function liveTty(projectRoot, seat) {
    const t = registry.get(keyOf(projectRoot, seat));
    return t && !t.exited ? t : undefined;
}
/** Every live TTY of one project — the multiplexed stream's roster. */
export function liveTtyList(projectRoot) {
    const out = [];
    for (const [k, t] of registry) {
        if (k.startsWith(`${projectRoot}|`) && !t.exited)
            out.push(t);
    }
    return out;
}
/**
 * Open (or reattach) the seat's interactive door. Refuses `busy` while a
 * headless turn is mid-flight — two doors, never two writers on one session.
 * Throws nothing: wall refusals and spawn failures come back as { error }.
 */
export async function startSeatTty(opts) {
    const { projectRoot, seat } = opts;
    const agent = normalizeAgent(opts.agent);
    const blended = opts.blended === true;
    const existing = liveTty(projectRoot, seat);
    if (existing)
        return { ok: true, tty: existing, reattached: true };
    // Kept for blended too: it protects the transition window while a headless
    // turn is still mid-flight on a just-flagged seat.
    if (isTurnActive(projectRoot, seat))
        return { ok: false, busy: true };
    let argv;
    // CRATE_WALLED (FLAWS "browser-tooling"): same stamp the runner puts on a
    // walled headless turn — in-box tools (the agent-browser shim) key
    // chromium's --no-sandbox injection off it, because a nested sandbox init
    // inside the wall is refused by the OS. The TTY door is the same session
    // behind the same wall, so it carries the same marker.
    let walled = false;
    // CE-014: is this spawn RESUMING a conversation, or starting a clean one?
    // Decided from the seat's own state, NOT from how argv gets built — the pane
    // mirror's correctness must not depend on which branch below runs. Read
    // BEFORE buildInteractiveInvocation, because pi's ttySessionId() WRITES the
    // file when it pre-mints, which would make a fresh seat look resumed.
    const resumingSession = hasResumableSession(projectRoot, seat, agent);
    if (opts.argvOverride) {
        argv = opts.argvOverride; // tests: a spawnable stub, no wall to render
    }
    else {
        try {
            // The SAME wall the runner renders — cwd = project root, same doors,
            // same refusal physics. Interactivity and containment are independent.
            const wall = resolveHeadlessWall(projectRoot, seat, agent);
            walled = wall !== undefined;
            // CE-129: a walled claude cannot persist its own trust answer (its
            // tmp+rename save shape is unexpressible through a single-file bind),
            // so the engine seeds it — attach was the operator's trust decision.
            if (agent === "claude") {
                const { preseedClaudeProjectTrust } = await import("./sandbox.js");
                preseedClaudeProjectTrust(opts.home ?? homedir(), projectRoot);
            }
            // Blend probe 3 (2026-08-18): agy's "Do you trust the contents of this
            // project?" modal blocks the composer on a first launch and its default
            // answer EATS the first delivery — a lost brief on every fresh-per-task
            // spawn. Seed the trust the same way, for the same reason.
            if (agent === "agy") {
                const { preseedAgyProjectTrust } = await import("./sandbox.js");
                preseedAgyProjectTrust(opts.home ?? homedir(), projectRoot);
            }
            const sessionId = ttySessionId(projectRoot, seat, agent);
            const inner = buildInteractiveInvocation(agent, { sessionId, model: opts.model, walled, seat });
            argv = wall ? [...wall.argvPrefix, ...inner] : inner;
        }
        catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    let ptyLib;
    try {
        ptyLib = await import("@lydell/node-pty");
    }
    catch (e) {
        return {
            ok: false,
            error: `the PTY backend is not installed (@lydell/node-pty) — run: cd ~/.crate/engine/core && npm install, ` +
                `then relaunch. (${e instanceof Error ? e.message : String(e)})`,
        };
    }
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 32;
    const startedAtMs = Date.now();
    // Union of both doors' stamps: seatEnv carries CRATE_SEAT (emit-identity —
    // a TTY session IS the seat's session) and CRATE_WALLED rides when the wall
    // is up (agent-browser shim keys --no-sandbox off it inside the wall).
    const env = {
        ...seatEnv(projectRoot, seat),
        TERM: "xterm-256color",
        ...(walled ? { CRATE_WALLED: "1" } : {}),
        // Backlog 14 (Adam's verify, 2026-08-14 — cmux is the reference): claude
        // seats render INLINE, never the alt-screen TUI. Fullscreen draws the
        // whole thread on the alternate screen, where scrollback cannot exist —
        // the pane had no bar and nothing to scroll into. Claude made fullscreen
        // the DEFAULT on 2026-05-06, so host settings.json drift ("tui":
        // "fullscreen" landed on superman) must not decide pane physics; this
        // pin overrides settings per-invocation and is inert for pi/codex.
        ...(agent === "claude" ? { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" } : {}),
    };
    if (blended && agent === "pi") {
        // Live probe (superman, 2026-08-12): pi's TUI crashes at import under the
        // system node v20; a blended pi seat must find node >= 22 first on PATH.
        const nodeBin = piNodeBinDir(opts.home ?? homedir());
        if (nodeBin)
            env.PATH = `${nodeBin}:${env.PATH ?? ""}`;
    }
    let proc;
    try {
        proc = ptyLib.spawn(argv[0], argv.slice(1), {
            name: "xterm-256color",
            cols,
            rows,
            cwd: projectRoot,
            env,
        });
    }
    catch (e) {
        return { ok: false, error: `could not open the ${agent} TUI: ${e instanceof Error ? e.message : String(e)}` };
    }
    // CE-014 rehydrate: a RESUMING spawn reopens the pane with its prior
    // scrollback; a fresh one starts blank AND clears the mirror, so clean eyes
    // stay clean. The banner marks where the old process stopped.
    const chunks = [];
    let chunkBytes = 0;
    const paneMirror = paneFile(projectRoot, seat);
    let mirrorBytes = 0;
    if (blended && resumingSession) {
        const prior = readPaneHistory(projectRoot, seat);
        if (prior.length > 0) {
            const banner = paneResumeBanner(localIsoOffset());
            // CE-126 (battle test 2026-08-17): park the restored history fully in
            // SCROLLBACK before any live output. An ink-style TUI boots by repainting
            // its frame with cursor-up + erase-line; cursor-up clamps at the viewport
            // top, so on a fresh terminal the boot repaint climbed ABOVE its own
            // frame and ate the just-replayed history — the orchestrator pane came
            // back blank while pane.raw held everything (proven against that ring in
            // a headless xterm: no pad = history destroyed, pad = history survives).
            // A viewport of newlines after the banner is a wall the repaint cannot
            // cross. RING-ONLY: the pad is never mirrored to pane.raw, so restarts
            // do not stack blank runs into the durable history.
            const pad = Buffer.from("\r\n".repeat(rows));
            chunks.push(prior, banner, pad);
            chunkBytes = prior.length + banner.length + pad.length;
            mirrorBytes = prior.length;
            try {
                appendFileSync(paneMirror, banner);
                mirrorBytes += banner.length;
            }
            catch {
                /* history is best-effort — never wedge the pane over it */
            }
        }
    }
    else {
        dropPaneHistory(projectRoot, seat);
    }
    // Multi-view size proposals (smallest-client-wins) — per-view latest fit.
    // A proposal lives exactly as long as its view's SSE stream (tmux's model:
    // the connection IS the liveness signal — no heartbeats, no TTL).
    const sizeProposals = new Map();
    // Recompute min-per-dimension over the live proposals and apply through
    // the storm guard (identical effective dims never SIGWINCH the TUI).
    const applyProposedSize = () => {
        if (sizeProposals.size === 0)
            return;
        let ec = Infinity;
        let er = Infinity;
        for (const v of sizeProposals.values()) {
            ec = Math.min(ec, v.c);
            er = Math.min(er, v.r);
        }
        if (ec === tty.cols && er === tty.rows)
            return;
        tty.cols = ec;
        tty.rows = er;
        try {
            proc.resize(ec, er);
        }
        catch { /* exited */ }
    };
    // Turn-boundary verify: a rolling (ts, bytes) log of pane output, pruned
    // to the last minute — the verifier's busy/quiet probe reads it.
    const outLog = [];
    const subs = new Set();
    const stamp = (line) => {
        try {
            appendFileSync(join(turnsDir(projectRoot, seat), "turns.log"), `${localIsoOffset()} | ${line}\n`);
        }
        catch {
            /* the session matters more than the note */
        }
    };
    // BADGE ABSENCE ≠ HUMANITY (Pack 2): persist the pane's pid so agentctl can
    // corroborate "is this command inside a seat session?" by ANCESTRY when the
    // env badge was stripped (`env -u CRATE_SEAT`) — macOS refuses to read
    // another process's env, but the parent-pid chain is always readable.
    // Removed on exit; a stale file self-heals on the reader side (alive +
    // spawn-time check guards pid reuse).
    const ptyPidFile = join(turnsDir(projectRoot, seat), "pty.json");
    try {
        writeFileSync(ptyPidFile, JSON.stringify({ pid: proc.pid, atMs: startedAtMs, agent }));
    }
    catch {
        /* the tripwire is best-effort — the session matters more */
    }
    const tty = {
        seat,
        projectRoot,
        agent,
        startedAtMs,
        cols,
        rows,
        blended,
        composerDirty: false,
        write: (d) => {
            // The HUMAN chokepoint (cockpit xterm → /api/tty/input → here): stamp
            // the quiet-composer clock before the bytes reach the PTY.
            tty.lastHumanInputMs = Date.now();
            tty.composerDirty = updateComposerDirty(tty.composerDirty, d);
            try {
                proc.write(d.toString("utf8"));
            }
            catch { /* exited between checks */ }
        },
        inject: (d) => {
            // The ENGINE door: never stamps the human clock — a delivery must not
            // push its own quiet window away or read as a half-typed draft.
            try {
                proc.write(typeof d === "string" ? d : d.toString("utf8"));
            }
            catch { /* exited */ }
        },
        resize: (c, r, client) => {
            // Multi-view policy (FLAWS 2026-08-12, smallest-client-wins): with a
            // client id, this call is a PROPOSAL — the PTY sizes to the min of
            // every live view's proposal, so the grid and a second cockpit never
            // leave each other mis-wrapped (last-writer-wins did).
            if (client) {
                sizeProposals.set(client, { c, r });
                applyProposedSize();
                return;
            }
            // Resize-storm guard (2026-08-12): the cockpit's 2s repaint re-fits
            // every seat; identical dims must never reach the TUI — a SIGWINCH
            // makes claude repaint its FULL transcript, and five seats doing that
            // flooded the cockpit link (~3 GB in 15 min over WiFi).
            if (c === tty.cols && r === tty.rows)
                return;
            tty.cols = c;
            tty.rows = r;
            try {
                proc.resize(c, r);
            }
            catch { /* exited */ }
        },
        dropSizeProposal: (client) => {
            // The view's stream closed — its clamp releases NOW; the survivors'
            // min applies immediately. No proposals left → the size just stands
            // (a reconnecting view re-proposes when its stream reopens).
            if (sizeProposals.delete(client))
                applyProposedSize();
        },
        kill: () => {
            try {
                proc.kill();
            }
            catch { /* already gone */ }
        },
        subscribe: (cb) => {
            subs.add(cb);
            return () => subs.delete(cb);
        },
        replay: () => Buffer.concat(chunks),
        outputBytesSince: (windowMs) => {
            const cut = Date.now() - windowMs;
            let sum = 0;
            for (let i = outLog.length - 1; i >= 0 && outLog[i][0] >= cut; i--)
                sum += outLog[i][1];
            return sum;
        },
    };
    proc.onData((d) => {
        const b = Buffer.from(d, "utf8");
        chunks.push(b);
        chunkBytes += b.length;
        while (chunkBytes > REPLAY_CAP && chunks.length > 1) {
            chunkBytes -= chunks[0].length;
            chunks.shift();
        }
        // Mirror to disk so the NEXT engine process can repaint this pane. Appends
        // are small; the trim rewrite fires only past 2x the cap, so the amortized
        // cost is one rewrite per REPLAY_CAP bytes of output rather than per chunk.
        if (blended) {
            try {
                appendFileSync(paneMirror, b);
                mirrorBytes += b.length;
                if (mirrorBytes > REPLAY_CAP * 2) {
                    writeFileSync(paneMirror, readPaneHistory(projectRoot, seat));
                    mirrorBytes = Math.min(mirrorBytes, REPLAY_CAP);
                }
            }
            catch {
                /* best-effort: a pane that cannot persist history still works */
            }
        }
        outLog.push([Date.now(), b.length]);
        while (outLog.length > 0 && outLog[0][0] < Date.now() - 60_000)
            outLog.shift();
        for (const cb of subs)
            cb({ data: b });
    });
    proc.onExit(({ exitCode, signal }) => {
        // CE-165 (battle-driver run #1): node-pty reports a SIGNAL death as
        // exitCode 0 + signal N, and this handler used to drop the signal — a
        // SIGKILLed session stamped "exit 0", indistinguishable from a polite
        // quit. The stamp IS the crash record (downchip, revive ceiling, incident
        // reads all key off it), so it names the signal now. CE-140 cured this
        // exact lie for runner seats; this was its unfixed blended sibling.
        tty.exited = { code: exitCode, ...(signal ? { signal } : {}) };
        const how = signal ? `killed by signal ${signal}` : `exit ${exitCode}`;
        try {
            rmSync(ptyPidFile);
        }
        catch { /* stale-safe: the reader alive-checks */ }
        if (blended) {
            // No hand-back seam: one door, nothing forked — the engine tracked the
            // session id continuously, so no re-point. The blend supervisor reads
            // this event (subscribe) and decides respawn; the stamp is the record.
            stamp(`blended ${agent} session exited (${how}) — the blend supervisor decides respawn`);
        }
        else {
            try {
                rmSync(attendedFile(projectRoot, seat));
            }
            catch { /* stale-safe */ }
            const sid = repointSessionAfterTty(projectRoot, seat, agent, startedAtMs - 2000, opts.home);
            stamp(`operator left — native ${agent} TUI closed (${how}); deliveries resume` +
                (sid ? `; session re-pointed to ${sid.slice(0, 8)}… (the human-driven fork)` : ""));
        }
        for (const cb of subs)
            cb({ exit: { code: exitCode } });
        // Guarded delete (blend relaunch lesson, live 2026-08-12): after an
        // evictSeatTty a SUCCESSOR pane may already own this key — a late exit
        // of the old process must never unregister the new session.
        if (registry.get(keyOf(projectRoot, seat)) === tty)
            registry.delete(keyOf(projectRoot, seat));
    });
    if (blended) {
        // A blended seat is NEVER held — a stale attended marker (crashed wheel
        // owner) would silently freeze its deliveries via runnerLoop's hold check.
        if (existsSync(attendedFile(projectRoot, seat))) {
            try {
                rmSync(attendedFile(projectRoot, seat));
                stamp(`stale attended marker cleared — blended seats are never held`);
            }
            catch { /* already gone */ }
        }
        stamp(`blended ${agent} session opened (engine-owned PTY; team mail is delivered into this live session)`);
    }
    else {
        // The hold + the honest record: the marker file is what the runner reads
        // (filesystem-visible across the server/runner process boundary).
        writeFileSync(attendedFile(projectRoot, seat), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        stamp(`operator attended — native ${agent} TUI open (the real ${agent}, inside the seat's wall); deliveries hold`);
    }
    registry.set(keyOf(projectRoot, seat), tty);
    return { ok: true, tty, reattached: false };
}
/** Close a seat's TTY (the UI's give-back-the-keys). No-op when none. */
export function stopSeatTty(projectRoot, seat) {
    const t = liveTty(projectRoot, seat);
    if (!t)
        return false;
    t.kill();
    return true;
}
/**
 * Evict a seat's TTY NOW: kill it AND drop it from the registry immediately,
 * not on the async exit event. The blend relaunch lesson (live proof,
 * 2026-08-12): a D12 refresh stops the old supervisor and starts its
 * successor in the SAME tick — the successor's eager spawn found the dying
 * pane still registered, REATTACHED to it, and the promised visible fresh
 * pane only appeared at the next delivery. Eviction closes that window; the
 * old process still dies by kill(), and onExit's guarded delete keeps a late
 * exit from unregistering the successor.
 */
export function evictSeatTty(projectRoot, seat) {
    const k = keyOf(projectRoot, seat);
    const t = registry.get(k);
    if (!t)
        return false;
    registry.delete(k);
    try {
        t.kill();
    }
    catch {
        /* already gone */
    }
    return true;
}
//# sourceMappingURL=ptyseat.js.map