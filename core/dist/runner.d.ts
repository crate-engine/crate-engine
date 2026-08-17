import { type HeadlessInvocation, type TurnUsage } from "./turn.js";
export interface RunTurnOpts {
    projectRoot: string;
    seat: string;
    /** Staffed agent (pi/claude/codex — must have a T0-verified wire). */
    agent: string;
    model?: string;
    turnTimeoutMs?: number;
    /** Tests: replace the real harness invocation with a stub. */
    invocationOverride?: (prompt: string, sessionId?: string) => HeadlessInvocation;
}
export interface TurnResult {
    ok: boolean;
    idle?: boolean;
    sessionId?: string;
    usage?: TurnUsage;
    logPath?: string;
    error?: string;
}
export declare function turnsDir(projectRoot: string, seat: string): string;
/** Make `.agents/state/turns/` ignore ITSELF (CE-014, 2026-08-17).
 *
 * This directory holds per-seat machine plumbing: session ids, turn logs, and
 * now pane.raw — the scrollback mirror, up to ~4MB of raw ANSI per seat. It was
 * never gitignored (confirmed with `git check-ignore` against a live rig), so
 * once the engine starts writing pane.raw a rig is one `git add -A` away from
 * committing a seat's entire terminal history.
 *
 * attach's managed .gitignore block now covers it, but that only reaches a rig
 * when attach RE-RUNS there — and the engine starts writing the mirror the
 * moment it updates. A self-ignoring directory needs no operator action and no
 * coordination with attach's writer: `turns/.gitignore` containing `*` is the
 * standard git idiom, is idempotent, and fixes EXISTING rigs on first touch.
 *
 * Best-effort by construction — a rig that cannot take this file still runs. */
export declare function ensureTurnsIgnored(turnsRoot: string): void;
export declare function sessionFile(projectRoot: string, seat: string): string;
/** Native-seat-access (PDR): a live turn's marker — the TTY door refuses to
 * open mid-turn (two doors, one room: never two writers on one session). */
export declare function activeTurnFile(projectRoot: string, seat: string): string;
/** True iff the marker names a LIVE pid — a stale lock (crashed runner) is
 * cleaned up, never treated as busy. isAlive injectable for tests. */
export declare function isTurnActive(projectRoot: string, seat: string, isAlive?: (pid: number) => boolean): boolean;
export declare function pidAlive(pid: number): boolean;
/** Native-seat-access: the attended marker — a human holds this seat's keys
 * (real TUI open on the seat's session). While it names a live pid the
 * runner does NOT start turns; mail queues and drains on release. */
export declare function attendedFile(projectRoot: string, seat: string): string;
export declare function isAttended(projectRoot: string, seat: string, isAlive?: (pid: number) => boolean): boolean;
/** The matched ack phrase, or undefined when the message is not absorbable —
 * exported so absorb stamps can NAME what matched (a silent classifier is
 * undiagnosable from turns.log; this one cost 35 live minutes to find). */
export declare function ackPhrase(body: string): string | undefined;
export declare function isAck(body: string): boolean;
/**
 * Resolve + cache a seat's wall AT BOOT (so the first turn reuses it — one
 * render, one bwrap probe) and return the human note. Throws the refusal for a
 * walled-required agent that cannot be walled — the caller reports it in plain
 * words before any turn runs. This is the single boot-time entry for both
 * `crate runner` and `crate team`.
 */
export declare function bootWall(projectRoot: string, seat: string, agent: string): string;
/** Process ONE batch of unread mail as one turn. Idle no-op when the box is empty. */
export declare function runTurn(opts: RunTurnOpts): Promise<TurnResult>;
/** P3-1 parity, headless (W4 finding #2, 2026-07-13): first-choice tools
 * (qa-sweep, agent-browser, axe-check, rg, …) resolve by NAME inside every
 * seat. The cmux launcher exported `<brain>/core/tools` on the pane's PATH;
 * the headless runner inherited nothing — the QA seat reported its in-box
 * tools "not installed" and self-graded partial. Composed per turn (cheap,
 * and correct across engine updates). A rig without .agents/bin (test
 * fixtures) falls back to the plain env — the tools shim needs a brain. */
export declare function seatEnv(projectRoot: string, seat: string): NodeJS.ProcessEnv;
export interface RunnerLoopOpts extends RunTurnOpts {
    pollMs?: number;
    /** Retries before a batch is dead-lettered (honest, never silent). */
    maxRetries?: number;
    /** D12 auto-mode (opt-in): auto-refresh the session when context crosses
     * the ceiling, at the turn boundary (state was just written = safe). */
    contextAutoRefresh?: boolean;
    signal?: AbortSignal;
    /** Injectable for tests; defaults to reading process.ppid. */
    getParentPid?: () => number;
    /** The supervisor's pid as the SPAWNER knew it (env CRATE_SUPERVISOR_PID) —
     * fixed before the child even starts, so the watchdog catches a supervisor
     * that died during our boot window (runner-deaths fix, FLAWS 2026-08-11).
     * Absent (standalone `crate runner`): fall back to capturing ppid at loop
     * start, today's behavior. */
    supervisorPid?: number;
    /** Where the orphan self-stamp lands (~/.crate/logs); defaults to $HOME.
     * Injectable so tests never write the developer's real ~/.crate. */
    home?: string;
    /** Blended-pane seam (PDR blended-pane, S1): replace the headless turn
     * executor while inheriting this loop's machinery verbatim — fs.watch wake,
     * attended hold, retry counting, dead-letter after maxRetries, backoff. A
     * blended seat's "turn" is a verified delivery into its live PTY session. */
    runTurnImpl?: (opts: RunTurnOpts) => Promise<TurnResult>;
}
/** The seat's standing loop: watch → turn → ack/retry → watch. */
export declare function runnerLoop(opts: RunnerLoopOpts): Promise<void>;
