import { type ContextGauge } from "./context.js";
export interface TurnEvent {
    /** Narrated one-liner ("editing slugify.js", "tests: 214 passed"). */
    narrated: string;
    /** Plain-English version for the Narrated lens (non-coder friendly);
     * falls back to `narrated` when there's nothing to simplify. */
    plain?: string;
    /** Raw jsonl line (Engineer lens). */
    raw: string;
    kind: "tool" | "text" | "result" | "system" | "stderr" | "meta" | "think" | "other";
}
export interface TurnView {
    file: string;
    startedAt: string;
    /** epoch ms of turn start (for the live elapsed readout). */
    startedAtMs?: number;
    ok: boolean | null;
    durationMs?: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    /** running token total seen so far (for the live readout). */
    liveTokens?: number;
    events: TurnEvent[];
    /** Terse narrated ticker (Adam's T2 ask): tool/result beats + the ONE
     * final conclusion line, deduped — not pi's full prose. */
    digest: string[];
    /** LIVE motion (Adam's T3 ask): the recent stream — tool calls +
     * thinking — so a running turn visibly WORKS in Narrated view, not a
     * dead pane. Collapses to the digest once the turn completes. */
    live: string[];
}
/** The recent stream for a running turn: meaningful beats (tool calls,
 * thinking) as a short tail, so the user SEES the agent working. */
export declare function liveTail(events: TurnEvent[], n?: number): string[];
/** Collapse a turn's events into a terse ticker. Rules: keep tool + result +
 * stderr beats (the "what happened"), keep only the LAST text event (the
 * conclusion, trimmed to one clause), drop system/chatter, dedupe repeats. */
export declare function narratedDigest(events: TurnEvent[]): string[];
export interface SeatView {
    seat: string;
    title: string;
    agent: string;
    model?: string;
    /** newest turn first */
    turns: TurnView[];
    /** freshest state/<seat>.md status line, if any */
    status?: string;
    lastActivity?: string;
    /** D12 context fullness gauge (undefined until the seat has run a turn). */
    gauge?: ContextGauge;
    /** unread mail waiting in the seat's inbox (the hold-blocked queue). */
    unread: number;
    /** a human holds this seat's wheel — deliveries are paused. */
    attended: boolean;
}
export interface TeamView {
    project: string;
    seats: SeatView[];
}
/** Best-effort narration of one raw stream line — adapter-shape-aware but
 * defensive (unknown lines degrade to a short raw echo, never throw). */
export declare function narrateLine(raw: string): TurnEvent;
export interface StreamEvent {
    /** seam=turn boundary · td=text delta · text=final text · think=thought
     * summary · tool=call beat · fold=output size note · errtail=failed-call
     * evidence · stderr=harness stderr · meta=turn end line */
    k: "seam" | "td" | "text" | "think" | "tool" | "fold" | "errtail" | "stderr" | "meta";
    t: string;
    /** plain-English flavor (tool beats only — the Narrated lens). */
    p?: string;
    /** meta only: did the turn succeed. */
    ok?: boolean;
}
/** Map one raw stream line to at most one live-feed event, per the locked
 * render policy. Returns undefined for lines the pane drops (toolcall arg
 * deltas, lifecycle chatter, successful small outputs). Defensive: an
 * unknown or unparseable line is dropped, never thrown on. */
export declare function streamEvent(raw: string): StreamEvent | undefined;
/** Reconstruct epoch ms from a turn file's name — shared with the tailer's
 * seam events (the filename IS the turn id). */
export declare function turnStartMs(name: string): number | undefined;
export declare function readTeamView(projectRoot: string, maxTurnsPerSeat?: number): TeamView;
