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
/**
 * Acknowledgment / "standing by" chatter that must NOT wake a turn — otherwise
 * two seats ping-pong acks forever after a loop closes (the drive-3 flaw:
 * orchestrator 27 turns / coder 22 for one tiny feature). A message that is
 * ONLY an ack is absorbed (marked read) without invoking the agent; real
 * requests never match this and still wake a turn.
 */
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
}
/** The seat's standing loop: watch → turn → ack/retry → watch. */
export declare function runnerLoop(opts: RunnerLoopOpts): Promise<void>;
