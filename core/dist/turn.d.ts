import type { Message } from "./mailbox.js";
export interface HeadlessInvocation {
    argv: string[];
    /** 'ignore' = spawn with stdin closed (the codex T0 quirk; harmless everywhere). */
    stdin: "ignore";
}
export declare function buildHeadlessInvocation(agent: string, opts: {
    prompt: string;
    sessionId?: string;
    model?: string;
    walled?: boolean;
}): HeadlessInvocation;
export interface TurnUsage {
    inputTokens: number;
    outputTokens: number;
}
/** Extract usage from ONE stream line (verbatim T0 shapes); undefined if not a usage line. */
export declare function parseUsage(agent: string, line: string): TurnUsage | undefined;
/** Extract the session/thread id from ONE stream line (T0 shapes). */
export declare function parseSessionId(agent: string, line: string): string | undefined;
/**
 * Compose one turn's prompt: orientation pointers (read, don't paste) +
 * the unread mail + the non-negotiable reporting laws. Every turn carries
 * the freshness-law reminder — D12's refusal rail depends on state being
 * written before a session can be swapped.
 *
 * SPEED LAW (overnight 2026-07-14, from the testuser8 turn logs): a RESUMED
 * session already holds the binder + docs from its first turn, and re-reading
 * them cost every relay turn 3–5 tool round-trips — ~half the wall-clock of a
 * 25-token-output turn. `resumed: true` composes the SLIM prompt: mail + the
 * compact rails, orientation only by exception ("unsure → re-read"). The full
 * orientation rides the FIRST turn of every session, and again after a D12
 * context refresh (the session file is gone, so the turn is not resumed).
 */
export declare function composeTurnPrompt(projectRoot: string, seat: string, mail: Message[], opts?: {
    resumed?: boolean;
}): string;
