// THE BLENDED PANE — S1 transport (PDR dev/pdr/blended-pane.md, GREENLIT).
//
// A blended seat is ONE live interactive agent session in an engine-owned
// PTY, always visible/typeable in its pane; the ENGINE delivers team mail
// INTO that session as a verified participant. No wheel, no hand-back, no
// attended hold. This module is the delivery transport:
//
//   render  → engine-voice mail block with an id marker (the verification
//             handle; bodies are never the marker — they repeat)
//   quiet   → the engine yields to the human (locked Q2): inject only on a
//             quiet composer, measured from the tty input chokepoint —
//             keystroke timestamps, zero screen parsing
//   inject  → bracketed paste (kills '@'//'/' popups on all three CLIs,
//             live-probed) + a gap + a SEPARATE CR (codex swallows an
//             immediate CR as a paste newline)
//   verify  → the delivered marker must appear as a USER record in the
//             agent's session file on disk; miss → ONE redelivery (visibly
//             labeled — duplication is the accepted failure mode, loss is
//             not, D11) → honest failure; mail stays queued
//
// Flag-gated per seat: rig.conf BLEND_<PREFIX>=1. Un-flagged seats keep the
// headless runner path byte-identical. claude/pi/codex are all eligible —
// each was live-probed (Mac claude 2.1.227; superman pi 0.84.1 + codex TUI
// 0.145.0, 2026-08-12): mid-turn queueing safe, session-file shapes pinned.
// Session lifecycle: the orchestrator PERSISTS; workers get a FRESH session
// per task (reset = visible respawn, lazily at the next delivery), with a
// per-seat rig.conf override (BLEND_<PREFIX>_PERSIST=1).
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { complete, readNew } from "./mailbox.js";
import { attendedFile, isAck, runnerLoop, sessionFile, turnsDir } from "./runner.js";
import { claudeProjectDir } from "./ptyseat.js";
import { RIG_PREFIX } from "./staffing.js";
import { normalizeAgent } from "./wall.js";
// ── flags (rig.conf; AUTO_REVIVE=1 precedent: "1" means on, default OFF) ──
export function isBlended(conf, seat) {
    return conf[`BLEND_${RIG_PREFIX[seat]}`] === "1";
}
/** Per-seat persistence override (locked Q1 safety valve): a worker seat
 * with BLEND_<PREFIX>_PERSIST=1 keeps its session across task boundaries so
 * quality claims can be tested empirically, never argued from theory. */
export function persistOverridden(conf, seat) {
    return conf[`BLEND_${RIG_PREFIX[seat]}_PERSIST`] === "1";
}
/** Eligibility = a live-verified TUI-queueing + session-file shape. All
 * three were probed tonight (2026-08-12); anything else stays on the proven
 * headless path with a plain-words reason — fail-open, never a dead seat. */
export function blendEligible(agentArg) {
    const a = normalizeAgent(agentArg);
    if (a === "claude" || a === "pi" || a === "codex")
        return { ok: true, cli: a };
    return {
        ok: false,
        reason: `${a} has no live-verified TUI queueing + session-file shape — ` +
            `the seat stays on the headless runner path until one is probed`,
    };
}
// ── engine-voice rendering (pure) ─────────────────────────────────────────
export function newDeliveryId() {
    return randomUUID().replace(/-/g, "").slice(0, 8);
}
/** The delivery block the engine pastes into the live session. The header's
 * #id is the verification marker AND the human-visible dedupe handle: a
 * REDELIVERY header makes an accidental duplicate visible + ignorable.
 * Emits NO control characters — submit (\r) is the injector's job. An
 * orientation block (fresh session's first delivery) rides between the
 * header and the mail so the pane VISIBLY shows the re-orientation (PDR S3:
 * a refresh restarts the session and it re-reads its checkpoint on screen). */
export function renderMailBlock(msgs, id, redelivery = false, orientation) {
    const header = redelivery
        ? `[team mail #${id} — REDELIVERY; ignore if already received]`
        : `[team mail #${id} — engine delivery, not the operator]`;
    return [header, ...(orientation ? [orientation] : []), ...msgs.map((m) => `[${m.at}] from ${m.from}: ${m.body}`)].join("\n");
}
/** The compact re-orientation a FRESH session's first delivery carries — the
 * blended twin of composeTurnPrompt's non-resumed orientation (turn.ts). A
 * persistent/resumed session already holds its binder in context (speed law)
 * and gets mail alone; a fresh one must be pointed at its laws + live state
 * or the first brief lands on a blank slate. Pure text, no control chars. */
export function renderOrientation(seat) {
    return (`[fresh session — orient first] Read in ONE pass: .agents/config/${seat}.md (your role binder — your laws), ` +
        `AGENTS.md if present, and .agents/state/${seat}.md + .agents/state/session.md (live state` +
        `${seat === "orchestrator" ? ", including your latest checkpoint" : ""}). Rails: never send an ack-only reply; ` +
        `keep .agents/state/${seat}.md describing NOW; transitions via python3 .agents/bin/agentctl.py emit <verb> ` +
        `--actor ${seat}; results to peers via python3 .agents/bin/agentctl.py deliver <role> --from ${seat} "<message>".`);
}
/** True iff this session has already received an engine delivery — every
 * delivery header starts "[team mail #", and it lands as a USER record. The
 * verifier's own user-only filter is reused verbatim, so an assistant merely
 * QUOTING a header can never mark a fresh session as oriented. */
export function sessionOriented(jsonlText, cli) {
    return jsonlText !== undefined && verifyDelivered(jsonlText, "[team mail #", cli);
}
// ── quiet composer (pure; fed by TtySeat.write timestamps) ────────────────
export const BLEND_QUIET_MS = 3000;
export const BLEND_LONG_QUIET_MS = 30_000;
/** The engine yields to the human (locked Q2). A dirty composer (printable
 * keys since the last CR/Esc — a likely half-typed draft) demands the LONG
 * quiet: our CR would submit their draft together with the mail. Never
 * typed at all = quiet. */
export function composerQuiet(state, nowMs, quietMs = BLEND_QUIET_MS, longQuietMs = BLEND_LONG_QUIET_MS) {
    if (state.lastHumanInputMs === undefined)
        return true;
    return nowMs - state.lastHumanInputMs >= (state.composerDirty ? longQuietMs : quietMs);
}
// ── session-file discovery (per CLI, live-probed paths) ───────────────────
/** pi keys its session dir by cwd (live probe, superman pi 0.84.1):
 * /home/x/scratch/wd → ~/.pi/agent/sessions/--home-x-scratch-wd--/ */
export function piSessionsDir(cwd, home) {
    return join(home, ".pi", "agent", "sessions", `--${cwd.split("/").filter(Boolean).join("-")}--`);
}
/** Every *.jsonl in a session dir touched at/after sinceMs, NEWEST FIRST
 * (full paths). The list form matters for all-seats coherence: several
 * blended seats share one cwd, so one dir holds several live sessions at
 * once — see findBlendSessionCandidates. */
export function sessionFilesIn(dir, sinceMs) {
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const f of names) {
        if (!f.endsWith(".jsonl"))
            continue;
        try {
            const m = statSync(join(dir, f)).mtimeMs;
            if (m >= sinceMs)
                out.push({ p: join(dir, f), m });
        }
        catch {
            /* raced a deletion */
        }
    }
    return out.sort((a, b) => b.m - a.m).map((e) => e.p);
}
/** Newest *.jsonl in a session dir touched at/after sinceMs → full path. */
export function newestSessionFileIn(dir, sinceMs) {
    return sessionFilesIn(dir, sinceMs)[0];
}
/** codex rollout files are date-keyed, NOT cwd-keyed — the first line is a
 * session_meta whose payload.cwd names the seat's dir (live probe shape). */
export function codexRolloutMatches(firstLine, cwd) {
    try {
        const d = JSON.parse(firstLine);
        return d.payload?.cwd === cwd;
    }
    catch {
        return false;
    }
}
export function codexSessionIdOf(firstLine) {
    try {
        const d = JSON.parse(firstLine);
        return d.payload?.session_id;
    }
    catch {
        return undefined;
    }
}
/** Scan ~/.codex/sessions/YYYY/MM/DD for EVERY rollout-*.jsonl born at/after
 * sinceMs whose session_meta cwd matches the seat, newest first. Spans the
 * spawn day and the next (a session opened before midnight writes on into
 * the new day only inside the same file, but the spawn itself may land
 * either side). */
export function codexRolloutsSince(home, cwd, sinceMs) {
    const out = [];
    for (const dayOffset of [0, 1]) {
        const d = new Date(sinceMs + dayOffset * 24 * 3600 * 1000);
        const dir = join(home, ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
        let names;
        try {
            names = readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const f of names) {
            if (!f.startsWith("rollout-") || !f.endsWith(".jsonl"))
                continue;
            const p = join(dir, f);
            try {
                const m = statSync(p).mtimeMs;
                if (m < sinceMs)
                    continue;
                const firstLine = readFileSync(p, "utf8").split("\n", 1)[0] ?? "";
                if (codexRolloutMatches(firstLine, cwd))
                    out.push({ p, m });
            }
            catch {
                /* raced */
            }
        }
    }
    return out.sort((a, b) => b.m - a.m).map((e) => e.p);
}
export function findCodexRollout(home, cwd, sinceMs) {
    return codexRolloutsSince(home, cwd, sinceMs)[0];
}
/** Session id from a session file's path/first line, per CLI shape. */
function sessionIdOfFile(cli, path) {
    const base = path.slice(path.lastIndexOf("/") + 1, -".jsonl".length);
    if (cli === "claude")
        return base;
    if (cli === "pi") {
        // filename shape (probed): <iso-ts>_<uuid>.jsonl
        return base.includes("_") ? base.slice(base.indexOf("_") + 1) : undefined;
    }
    try {
        return codexSessionIdOf(readFileSync(path, "utf8").split("\n", 1)[0] ?? "");
    }
    catch {
        return undefined; // first line unreadable yet
    }
}
/**
 * EVERY live-session candidate born/touched at/after sinceMs, newest first.
 * ALL-SEATS COHERENCE (PDR S3): with the whole team blended, five seats
 * share ONE cwd — so claude's munged project dir, pi's munged sessions dir,
 * and codex's cwd-matched rollouts each hold SEVERAL seats' sessions at
 * once, and "the newest file" can be ANOTHER seat's session. Discovery
 * therefore cannot pick-and-trust: the supervisor verifies deliveries
 * against every candidate and PINS the file the delivery marker actually
 * landed in (self-verifying discovery — the same physics as delivery
 * verification, so a mis-pin is impossible).
 */
export function findBlendSessionCandidates(cli, opts) {
    const home = opts.home ?? homedir();
    let root = opts.projectRoot;
    try {
        root = realpathSync(opts.projectRoot);
    }
    catch {
        /* keep as given */
    }
    const files = cli === "claude"
        ? sessionFilesIn(claudeProjectDir(root, home), opts.sinceMs)
        : cli === "pi"
            ? sessionFilesIn(piSessionsDir(root, home), opts.sinceMs)
            : codexRolloutsSince(home, root, opts.sinceMs);
    return files.map((p) => {
        const sid = sessionIdOfFile(cli, p);
        return { path: p, ...(sid ? { sessionId: sid } : {}) };
    });
}
/** Newest candidate — the single-seat fast path (and the pre-pin fallback
 * for gauges/responding, where best-effort is honest enough). */
export function findBlendSession(cli, opts) {
    return findBlendSessionCandidates(cli, opts)[0];
}
// ── delivery verification (pure over session-jsonl text) ──────────────────
function textParts(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => {
            const t = c;
            return typeof t.text === "string" ? t.text : "";
        })
            .join("\n");
    }
    return "";
}
/** One parsed jsonl record is a USER-authored record carrying the marker
 * (per-CLI probed shapes). Shared by delivery verification and the early-
 * stop watchdog so both read the same physics. */
function isUserRecordWithMarker(d, marker, cli) {
    if (cli === "claude") {
        // probed: {"type":"user","message":{"role":"user","content":...}}
        const msg = d.message;
        return d.type === "user" && msg?.role === "user" && textParts(msg.content).includes(marker);
    }
    if (cli === "pi") {
        // probed: {"type":"message","message":{"role":"user","content":[{"type":"text","text":...}]}}
        const msg = d.message;
        return d.type === "message" && msg?.role === "user" && textParts(msg.content).includes(marker);
    }
    // probed, two shapes carry the delivered text verbatim:
    //   {"type":"event_msg","payload":{"type":"user_message","message":...}}
    //   {"type":"response_item","payload":{"role":"user","content":[{"type":"input_text",...}]}}
    const payload = d.payload;
    if (d.type === "event_msg" && payload?.type === "user_message" && typeof payload.message === "string" && payload.message.includes(marker))
        return true;
    return d.type === "response_item" && payload?.role === "user" && textParts(payload.content).includes(marker);
}
/** One parsed jsonl record is ASSISTANT-authored (per-CLI probed shapes) —
 * the sign a response turn is underway. */
function isAssistantRecord(d, cli) {
    if (cli === "claude")
        return d.type === "assistant";
    if (cli === "pi") {
        const msg = d.message;
        return d.type === "message" && msg?.role === "assistant";
    }
    const payload = d.payload;
    return (d.type === "event_msg" && payload?.type === "agent_message") || (d.type === "response_item" && payload?.role === "assistant");
}
function parseJsonlLines(jsonlText) {
    const out = [];
    for (const line of jsonlText.split("\n")) {
        if (!line.trim())
            continue;
        try {
            out.push(JSON.parse(line));
        }
        catch {
            /* partial trailing line mid-write, or junk — tolerate */
        }
    }
    return out;
}
/** True iff the marker appears in a USER-authored record of the session
 * file. The user-only filter is load-bearing: the assistant's reply echoes
 * the marker in later lines, and an echo is not a delivery. Malformed and
 * partial trailing lines are skipped, never thrown on. */
export function verifyDelivered(jsonlText, marker, cli) {
    return parseJsonlLines(jsonlText).some((d) => isUserRecordWithMarker(d, marker, cli));
}
/** True iff an ASSISTANT record follows the marker's USER record — the mail
 * is being attended (or already was). The early-stop watchdog's disarm
 * signal. Records before the marker never count: an assistant that was
 * mid-response when the mail queued has not necessarily seen it. */
export function assistantTurnStartedAfter(jsonlText, marker, cli) {
    let markerSeen = false;
    for (const d of parseJsonlLines(jsonlText)) {
        if (!markerSeen)
            markerSeen = isUserRecordWithMarker(d, marker, cli);
        else if (isAssistantRecord(d, cli))
            return true;
    }
    return false;
}
/** Gauge fuel without headless stream-json: the LAST assistant record's
 * message.usage. Context fullness = input + cache-read tokens. Absent or
 * unparseable → undefined — degrade honestly, never fake a gauge. The exact
 * nesting is a swappable pure parser by design (pin against live runs). */
export function sessionUsage(jsonlText) {
    let out;
    for (const line of jsonlText.split("\n")) {
        if (!line.includes('"usage"'))
            continue;
        try {
            const d = JSON.parse(line);
            const u = d.message?.usage;
            if (d.type === "assistant" && u && (u.input_tokens !== undefined || u.output_tokens !== undefined)) {
                out = {
                    // Context fullness = the WHOLE prompt: fresh + cache-read + cache-
                    // creation tokens (Adam's gauge catch, 2026-08-12 — omitting cache
                    // creation undercounts turns that write new cache).
                    inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
                    outputTokens: u.output_tokens ?? 0,
                };
            }
        }
        catch {
            /* partial line */
        }
    }
    return out;
}
// ── the delivery writer ───────────────────────────────────────────────────
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
/** Per-CLI delivery physics, all live-probed. The submit gap is uniform at
 * 1s: codex groups literal-text+immediate-CR as one paste (the CR becomes a
 * composer newline — reproduced), claude proved 400ms, pi tolerated 0 — one
 * safe gap for all three. Verify ceilings are uniform at 120s: pi/codex
 * write the queued message to the session file only when the in-flight turn
 * ENDS (timing law), so the window must span the turn remainder — and
 * claude's probed ~1.2s mid-turn write turned out to hold only on a QUIET
 * boundary. A long tool execution defers it past any short ceiling
 * (recurrence data, ticket-#4 retro: 6 dead-letters in one day under a 30s
 * ceiling, ALL at busy boundaries — joins and a 98-tool-call QA session).
 * The fast poll keeps claude's common case snappy; the long ceiling absorbs
 * the busy one. */
export const CLI_DELIVERY = {
    claude: { submitDelayMs: 1000, verifyTimeoutMs: 120_000, verifyPollMs: 250 },
    pi: { submitDelayMs: 1000, verifyTimeoutMs: 120_000, verifyPollMs: 2000 },
    codex: { submitDelayMs: 1000, verifyTimeoutMs: 120_000, verifyPollMs: 2000 },
};
const realSleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** Real-time sleep whose timer never holds the process open — the early-stop
 * watchdog's clock. The watchdog deliberately does NOT inherit a caller's
 * injected sleep/now: a fake instant sleep against the real clock turns its
 * minutes-long window into a hot spin (live-found: blendteam suite pinned at
 * 100% CPU), and a pending real timer must never block process exit. */
const unrefSleep = (ms) => new Promise((res) => {
    const t = setTimeout(res, ms);
    t.unref?.();
});
/**
 * Deliver one mail batch into a live blended session, verified. Waits
 * INDEFINITELY for a quiet composer (the engine yields to the human; mail
 * queues losslessly meanwhile — locked Q2). Miss → ONE redelivery with a
 * visible REDELIVERY header (D11: duplication is the accepted failure mode,
 * loss is not) → honest failure; the CALLER keeps the mail queued and stamps.
 */
export async function deliverToBlendedSeat(o) {
    const sleep = o.sleep ?? realSleep;
    const now = o.now ?? Date.now;
    const cliDef = CLI_DELIVERY[o.cli];
    const submitDelayMs = o.submitDelayMs ?? cliDef.submitDelayMs;
    const verifyTimeoutMs = o.verifyTimeoutMs ?? cliDef.verifyTimeoutMs;
    const verifyPollMs = o.verifyPollMs ?? cliDef.verifyPollMs;
    const id = o.id ?? newDeliveryId();
    const marker = `#${id}`;
    const verified = () => {
        const text = o.readSession();
        return text !== undefined && verifyDelivered(text, marker, o.cli);
    };
    const waitQuiet = async () => {
        while (!o.signal?.aborted && !composerQuiet(o.tty, now(), o.quietMs, o.longQuietMs)) {
            await sleep(o.quietPollMs ?? 250);
        }
    };
    for (const attempt of [1, 2]) {
        if (o.signal?.aborted)
            return { ok: false, id, attempts: attempt - 1, error: "aborted" };
        await waitQuiet();
        // Before any re-paste of an already-pasted id, look again: a slow write
        // (long in-flight turn, long tool execution) may have landed the earlier
        // attempt late — pasting again would be a needless duplicate. attempts=0
        // = a prior CALL's paste drained; the caller stamps it as a late landing.
        if ((attempt === 2 || o.redelivery) && verified())
            return { ok: true, id, attempts: attempt - 1 };
        const block = renderMailBlock(o.msgs, id, attempt === 2 || o.redelivery === true, o.orientation);
        o.tty.inject(PASTE_START + block + PASTE_END);
        await sleep(submitDelayMs);
        o.tty.inject("\r"); // a SEPARATE CR — an immediate one is swallowed into the paste (codex)
        const t0 = now();
        while (now() - t0 < verifyTimeoutMs && !o.signal?.aborted) {
            if (verified())
                return { ok: true, id, attempts: attempt, verifyMs: now() - t0 };
            await sleep(verifyPollMs);
        }
    }
    return { ok: false, id, attempts: 2, error: `not verified in session file after 2 attempts` };
}
// ── the early-stop watchdog (delivered ≠ attended) ────────────────────────
/** How long a verified delivery may sit with NO assistant turn before the
 * engine nudges (ticket-#4 flaw: 8 minutes of silence at a full-hand join
 * until a human typed "continue" — frontier-model early stopping is a known
 * mode; the harness absorbs it, the operator is never the watchdog). A
 * normal turn starts within seconds; 3 minutes is far outside honest
 * latency and far inside the operator's patience. */
export const EARLY_STOP_NUDGE_MS = 180_000;
/** The one standing nudge. Defensive wording on purpose: pi/codex session
 * files may only gain records at turn boundaries, so a long legitimate turn
 * can look unstarted from disk — a nudge that lands mid-work must read as
 * ignorable, exactly like a REDELIVERY header. */
export function renderEarlyStopNudge(id) {
    return (`[engine watchdog] team mail #${id} was delivered and verified above, but no response turn has started — ` +
        `if you are already working, ignore this; otherwise handle the mail now.`);
}
/**
 * The other half of verified delivery (build-ready cure, 2026-08-12): the
 * engine proved the mail landed in the session — now prove it was PICKED UP.
 * Watches the session file after a verified delivery; if no assistant record
 * follows the marker within the window, injects ONE standing nudge (quiet-
 * composer gated, same yield law as delivery). Disarms silently when the
 * turn starts, a newer delivery supersedes it, the pane dies, or the marker
 * vanishes from the session text (respawn/refresh — stale marker, stale
 * watchdog). Returns true iff the nudge was injected.
 */
export async function watchForEarlyStop(o) {
    const sleep = o.sleep ?? realSleep;
    const now = o.now ?? Date.now;
    const nudgeAfterMs = o.nudgeAfterMs ?? EARLY_STOP_NUDGE_MS;
    const pollMs = o.pollMs ?? 15_000;
    const marker = `#${o.id}`;
    const superseded = () => o.signal?.aborted === true || o.tty.exited !== undefined || (o.wdRef !== undefined && o.gen !== undefined && o.wdRef.gen !== o.gen);
    const turnStarted = () => {
        const text = o.readSession();
        if (text === undefined || !verifyDelivered(text, marker, o.cli))
            return "stale";
        return assistantTurnStartedAfter(text, marker, o.cli);
    };
    const t0 = now();
    while (now() - t0 < nudgeAfterMs) {
        await sleep(Math.min(pollMs, Math.max(1, nudgeAfterMs - (now() - t0))));
        if (superseded())
            return false;
        const started = turnStarted();
        if (started === true || started === "stale")
            return false;
    }
    // The window closed on silence. Yield to the human, then one last look —
    // a turn that started during the quiet wait must not be nudged mid-work.
    while (!superseded() && !composerQuiet(o.tty, now(), o.quietMs, o.longQuietMs))
        await sleep(o.quietPollMs ?? 250);
    if (superseded() || turnStarted() !== false)
        return false;
    o.tty.inject(PASTE_START + renderEarlyStopNudge(o.id) + PASTE_END);
    await sleep(o.submitDelayMs ?? 1000);
    o.tty.inject("\r");
    return true;
}
// ── fresh-per-task session reset (locked Q1) ──────────────────────────────
/** Task-ending events in .agents/state/events.log — agentctl writes accepted
 * lines as `[iso] TRANSITION actor=… state=…`; a task ends when it lands at
 * idle: CLOSE, ABANDON, RESEARCH_DONE (state-machine.yaml is the authority;
 * REJECTED lines never count). */
export function isTaskEndEvent(line) {
    const t = line.trim().split(/\s+/)[1];
    return t === "CLOSE" || t === "ABANDON" || t === "RESEARCH_DONE";
}
export function taskEndsIn(chunk) {
    return chunk.split("\n").filter((l) => l.trim() && isTaskEndEvent(l)).length;
}
/** Which blended seats get fresh eyes at a task boundary: WORKERS only (the
 * orchestrator persists — its memory is the project's arc), minus any seat
 * whose rig.conf persistence override is on (the Q1 safety valve). */
export function seatsToReset(blendedSeats, conf) {
    return blendedSeats.filter((s) => s !== "orchestrator" && !persistOverridden(conf, s));
}
export function createStaleTracker() {
    const stale = new Set();
    return {
        isStale: (s) => stale.has(s),
        markStale: (s) => stale.add(s),
        clear: (s) => stale.delete(s),
    };
}
/**
 * Watch events.log for task ends and mark the resettable blended seats
 * stale. The reset itself is LAZY — the next delivery respawns (memory
 * within a task, clean eyes between tasks; nothing is torn down mid-idle
 * for no reader). Returns the unwatch. Poll-based (1s): events.log lives on
 * plain disk and agentctl appends whole lines; a missed instant costs one
 * tick, and fs.watch's rename semantics across editors/rotations are not
 * worth the fragility here.
 */
export function watchTaskEnds(projectRoot, onTaskEnd, opts = {}) {
    const log = join(projectRoot, ".agents", "state", "events.log");
    let offset = 0;
    try {
        offset = statSync(log).size; // only NEW events count — history is not a boundary
    }
    catch {
        /* not born yet */
    }
    const tick = () => {
        let size = 0;
        try {
            size = statSync(log).size;
        }
        catch {
            return;
        }
        if (size < offset)
            offset = 0; // rotated/truncated — re-read honestly
        if (size === offset)
            return;
        let text;
        try {
            text = readFileSync(log, "utf8");
        }
        catch {
            return;
        }
        const chunk = text.slice(offset);
        offset = text.length;
        if (taskEndsIn(chunk) > 0)
            onTaskEnd();
    };
    const timer = setInterval(tick, opts.pollMs ?? 1000);
    timer.unref?.();
    return () => clearInterval(timer);
}
// ── codex spawn handshake (trust dialog) ──────────────────────────────────
/** codex's first launch in a new cwd blocks on a directory-trust dialog
 * (live-probed; fires per rig dir, then remembered) — with fresh-per-task
 * workers that is the FIRST spawn in every rig. The pending modal would eat
 * an injected CR, so the supervisor answers it before marking the seat
 * ready. */
export function needsTrustAnswer(replayText) {
    return /Do you trust the contents/i.test(replayText);
}
/** claude's folder-trust dialog (live proof, 2026-08-12): a FRESH claude TUI
 * in this rig dir blocks on "Is this a project you created or one you
 * trust?" even though ~/.claude.json is a wall door — the accepted flag
 * never persists from inside the wall (observed empty project entry after an
 * accepted dialog), so with fresh-per-task workers the dialog is back on
 * EVERY respawn and would eat the first delivery's paste. Detection is over
 * ANSI-normalized, whitespace-collapsed replay: the live pane renders its
 * spacing as cursor-forward sequences, so a literal-space needle never
 * matches the raw stream. */
export function needsClaudeTrustAnswer(replayText) {
    const flat = replayText.replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "").replace(/\s+/g, "");
    return /Yes,Itrustthisfolder|projectyoucreatedoroneyoutrust/i.test(flat);
}
/** Answer claude's folder-trust dialog with a bare CR — option 1 ("Yes, I
 * trust this folder") is preselected. The needle is STRICT to this dialog by
 * design: the bypass-permissions warning defaults to "No, exit", so a blind
 * CR into the wrong modal must be impossible. */
export async function claudeTrustHandshake(readReplay, tty, opts = {}) {
    const sleep = opts.sleep ?? realSleep;
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const pollMs = opts.pollMs ?? 250;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (needsClaudeTrustAnswer(readReplay())) {
            tty.inject("\r");
            return true;
        }
        await sleep(pollMs);
    }
    return false; // no dialog inside the window — an already-trusted dir, fine
}
export async function codexTrustHandshake(readReplay, tty, opts = {}) {
    const sleep = opts.sleep ?? realSleep;
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const pollMs = opts.pollMs ?? 250;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (needsTrustAnswer(readReplay())) {
            tty.inject("1");
            await sleep(250);
            tty.inject("\r");
            return true;
        }
        await sleep(pollMs);
    }
    return false; // no dialog inside the window — already-trusted dir, fine
}
function stampTurns(projectRoot, seat, line) {
    try {
        appendFileSync(join(turnsDir(projectRoot, seat), "turns.log"), `${new Date().toISOString()} | ${line}\n`);
    }
    catch {
        /* the delivery matters more than the note */
    }
}
/** Honest-failure record in events.log (PDR: "honest failure stamped to
 * events/turns.log"). Deliberately carries NO state= token: agentctl's
 * task_states parser only reads state=, so this line is provably inert to
 * the state machine — a record, never a transition. */
function stampDeliverFailed(projectRoot, seat, id, reason) {
    try {
        appendFileSync(join(projectRoot, ".agents", "state", "events.log"), `[${new Date().toISOString()}] DELIVER_FAILED actor=engine seat=${seat} id=#${id} reason="${reason}"\n`);
    }
    catch {
        /* turns.log already carries it */
    }
}
/**
 * One blended "turn": drain the seat's unread mail as ONE verified delivery
 * into its live session. Mirrors runTurn's contract exactly so runnerLoop's
 * machinery (wake, retries, dead-letter, backoff) is inherited verbatim via
 * the runTurnImpl seam. Ack absorption and at-least-once are the runner's
 * rules, reused: complete() ONLY after on-disk verification.
 */
export async function blendedTurn(o) {
    const { projectRoot, seat } = o;
    const sleep = o.sleep ?? realSleep;
    const inboxRoot = join(projectRoot, ".agents", "state", "inbox");
    const mail = readNew(inboxRoot, seat);
    if (mail.length === 0)
        return { ok: true, idle: true };
    // The runner's loop-breaker, verbatim rule: a batch of pure seat-to-seat
    // acks is absorbed without waking the pane; the OPERATOR's mail is never
    // absorbed (W4 finding #4 — the human's one input must always land).
    if (mail.every((m) => m.from !== "operator" && isAck(m.body))) {
        complete(inboxRoot, seat, mail);
        stampTurns(projectRoot, seat, `absorbed | ${mail.length} ack(s), no delivery`);
        return { ok: true, idle: true };
    }
    // The external fresh-start lever (verify-dispatch fresh-eyes + D12): an
    // outside hand rm'd turns/<seat>/session.json since our last persist —
    // agentctl does it BEFORE mailing the verify brief precisely so the seat
    // cannot grade its own homework. Honor it as a stale mark so THIS delivery
    // opens clean eyes. Consumed once: a later failed-delivery retry must not
    // respawn again and again.
    if (o.persistRef?.persisted && !o.stale.isStale(seat) && !existsSync(sessionFile(projectRoot, seat))) {
        o.persistRef.persisted = false;
        o.stale.markStale(seat);
        stampTurns(projectRoot, seat, `session.json dropped by the fresh-start lever (verify-dispatch fresh-eyes / D12 refresh / context auto-refresh) — fresh session for this delivery`);
    }
    // Lazy fresh-per-task reset (locked Q1): the task boundary marked this
    // worker stale; the NEXT delivery — this one — respawns first so the new
    // brief opens a fresh session's memory. Also the crash-recovery path.
    // Stale is checked BEFORE the registry: a reset respawns no matter what
    // pane is currently live (kill → spawn → deliver, in that order).
    let tty;
    let freshlySpawned = false;
    if (o.stale.isStale(seat)) {
        // Graceful restart: never tear a mid-response turn in half. The engine
        // yields (mail queues losslessly) until the session file goes quiet —
        // the blended twin of D12's mid-turn refusal.
        if (o.responding?.()) {
            stampTurns(projectRoot, seat, `fresh respawn deferred — the agent is mid-response; waiting for quiet before the reset`);
            while (!o.signal?.aborted && o.responding())
                await sleep(500);
            if (o.signal?.aborted)
                return { ok: false, error: "aborted while waiting to reset" };
        }
        stampTurns(projectRoot, seat, `task boundary — respawning fresh (clean eyes for the next brief)`);
        tty = await o.respawn("task boundary — fresh session per task");
        o.stale.clear(seat);
        freshlySpawned = true;
    }
    else {
        const live = o.getTty();
        if (!live || live.exited) {
            stampTurns(projectRoot, seat, `no live session — respawning before delivery`);
            tty = await o.respawn("session not live at delivery time");
            freshlySpawned = true;
        }
        else {
            tty = live;
        }
    }
    if (freshlySpawned) {
        // Probe-1 lesson: a startup modal ate the first paste, and a blind Esc
        // to clear state is forbidden (it interrupts a live turn). Settle, then
        // rely on the verify+redelivery ladder to catch a still-eaten paste.
        await sleep(o.spawnSettleMs ?? 3000);
    }
    // The visible re-orientation (PDR S3): a fresh session's FIRST delivery
    // points the agent at its binder + live state on screen; a session that
    // already received team mail (or a crash-resume, via the supervisor's
    // override) gets mail alone (speed law — orientation is already in context).
    const needsOrient = o.needsOrientation ? o.needsOrientation() : !sessionOriented(o.readSession(), o.cli);
    // Retry continuity: the SAME unchanged batch retries under its ORIGINAL id
    // (visible REDELIVERY, late landings drained) — a fresh id per retry made
    // dedup-by-id impossible for consumers and re-minted every slow landing as
    // brand-new mail (live-found by the rig's own orchestrator, 2026-08-12).
    const batchKey = mail.map((m) => m.name).join("|");
    const retryId = o.retryRef?.batch === batchKey ? o.retryRef.id : undefined;
    const r = await deliverToBlendedSeat({
        tty,
        msgs: mail,
        cli: o.cli,
        readSession: o.readSession,
        orientation: needsOrient ? renderOrientation(seat) : undefined,
        id: retryId,
        redelivery: retryId !== undefined,
        quietMs: o.quietMs,
        longQuietMs: o.longQuietMs,
        quietPollMs: o.quietPollMs,
        submitDelayMs: o.submitDelayMs,
        verifyTimeoutMs: o.verifyTimeoutMs,
        verifyPollMs: o.verifyPollMs,
        signal: o.signal,
        sleep,
        now: o.now,
    });
    if (!r.ok) {
        // Park the id for the retry: the next attempt at this same batch wears
        // the REDELIVERY header and pre-checks the marker before pasting.
        if (o.retryRef) {
            o.retryRef.id = r.id;
            o.retryRef.batch = batchKey;
        }
        stampTurns(projectRoot, seat, `delivery FAILED | #${r.id} | ${r.error ?? "unverified"} — mail stays queued`);
        stampDeliverFailed(projectRoot, seat, r.id, r.error ?? "unverified");
        return { ok: false, error: `delivery #${r.id} ${r.error ?? "unverified"}` };
    }
    if (o.retryRef) {
        o.retryRef.id = undefined;
        o.retryRef.batch = undefined;
    }
    complete(inboxRoot, seat, mail); // ack ONLY after on-disk verification (at-least-once)
    // Pin BEFORE reading the id: the marker just proved which candidate file
    // is OURS (all-seats coherence — several blended seats share one cwd).
    o.onVerified?.(r.id);
    const sid = o.currentSessionId();
    if (sid) {
        // Gauges and crash-resume read this; blended:true tells every reader the
        // session is live in a pane, not a headless resume target.
        writeFileSync(sessionFile(projectRoot, seat), JSON.stringify({ agent: o.cli, sessionId: sid, blended: true }));
        if (o.persistRef)
            o.persistRef.persisted = true; // arms the external-drop lever
    }
    const usage = sessionUsage(o.readSession() ?? "");
    stampTurns(projectRoot, seat, `delivered | #${r.id} | mail=${mail.length} | verified in ${sid ? `${sid.slice(0, 8)}….jsonl` : "session file"}` +
        `${r.verifyMs !== undefined ? ` after ${r.verifyMs}ms` : ""}${r.attempts > 1 ? " | on redelivery" : ""}` +
        `${r.attempts === 0 ? " | late landing drained — no re-paste" : ""}`);
    // The other half of verification: the mail LANDED — now watch that it gets
    // PICKED UP. One floating watchdog per seat; a newer delivery supersedes.
    if (o.wdRef) {
        const gen = ++o.wdRef.gen;
        void watchForEarlyStop({
            tty,
            cli: o.cli,
            readSession: o.readSession,
            id: r.id,
            wdRef: o.wdRef,
            gen,
            nudgeAfterMs: o.nudgeAfterMs,
            pollMs: o.watchdogPollMs,
            quietMs: o.quietMs,
            longQuietMs: o.longQuietMs,
            quietPollMs: o.quietPollMs,
            submitDelayMs: o.submitDelayMs,
            signal: o.signal,
            // ALWAYS the real clock (see unrefSleep) — the delivery's injectable
            // sleep/now stay out of the background babysitter on purpose.
            sleep: unrefSleep,
        })
            .then((nudged) => {
            if (!nudged)
                return;
            stampTurns(projectRoot, seat, `early-stop watchdog | #${r.id} delivered but no turn started — standing nudge injected`);
            try {
                // A record, never a transition — no state= token (agentctl's parser
                // only reads state=), same law as DELIVER_FAILED.
                appendFileSync(join(projectRoot, ".agents", "state", "events.log"), `[${new Date().toISOString()}] WATCHDOG_NUDGE actor=engine seat=${seat} id=#${r.id} reason="delivery verified, no assistant turn in window — nudge injected"\n`);
            }
            catch {
                /* turns.log already carries it */
            }
        })
            .catch(() => {
            /* a dying watchdog must never take the loop with it */
        });
    }
    return { ok: true, sessionId: sid, usage };
}
/**
 * The flagged seat's standing loop: runnerLoop with the delivery turn
 * injected. Runs IN the engine-server process (the PTY registry is
 * in-process state — a `crate runner` child could never reach the pane), so
 * the orphan watchdog is neutralized: the supervisor's lifetime IS ours.
 */
export function blendedLoop(o) {
    // A stale attended marker would silently freeze deliveries via the loop's
    // hold check — blended seats are never held. Clear it before the first wake.
    const att = attendedFile(o.projectRoot, o.seat);
    if (existsSync(att)) {
        try {
            rmSync(att);
            stampTurns(o.projectRoot, o.seat, `stale attended marker cleared at blended boot — blended seats are never held`);
        }
        catch {
            /* isAttended's dead-pid self-clean covers it */
        }
    }
    // Per-seat continuity refs, owned by the loop so they span retries: a
    // failed batch retries under its own id (retryRef), and each verified
    // delivery arms/supersedes the seat's one early-stop watchdog (wdRef).
    const turnOpts = { ...o, retryRef: o.retryRef ?? {}, wdRef: o.wdRef ?? { gen: 0 } };
    const loopOpts = {
        projectRoot: o.projectRoot,
        seat: o.seat,
        agent: o.cli,
        model: o.model,
        contextAutoRefresh: o.contextAutoRefresh,
        pollMs: o.pollMs,
        maxRetries: o.maxRetries,
        signal: o.signal,
        getParentPid: () => 0, // in-process loop: no supervisor process boundary to orphan across
        // Contained like runTurn (which never throws): a throwing respawn — spawn
        // refusal, kill timeout — must read as a FAILED turn (mail stays queued,
        // retry/dead-letter machinery inherited), never kill the standing loop.
        runTurnImpl: async () => {
            try {
                return await blendedTurn(turnOpts);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                stampTurns(o.projectRoot, o.seat, `delivery turn CRASHED: ${msg} — mail stays queued`);
                return { ok: false, error: msg };
            }
        },
    };
    return runnerLoop(loopOpts);
}
//# sourceMappingURL=blend.js.map