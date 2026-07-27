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
}
/** The seat's standing loop: watch → turn → ack/retry → watch. */
export declare function runnerLoop(opts: RunnerLoopOpts): Promise<void>;
