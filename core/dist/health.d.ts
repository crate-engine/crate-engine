import type { Seat } from "./manifest.js";
export type Liveness = "live" | "signed-out" | "usage-limited" | "dead" | "unknown";
/**
 * Run #12 finding: a long-running claude seat's OAuth token can go stale
 * (overnight) — the harness keeps running but every request 401s, and an
 * in-session /login does NOT recover it (only a relaunch re-reads the
 * keychain). These markers flag a seat "signed-out" so the UI can offer
 * Relaunch. (Kept for the turn-log scan; liveness ≠ usability.)
 */
export declare const AUTH_STALE_RE: RegExp;
/**
 * CE-143 — a blended seat whose MODEL refuses for usage reasons is invisibly
 * dead. Observed live on Adam's own account 2026-08-18: the pane carried
 * "You've reached your Fable 5 limit. Run /usage-credits to continue or switch
 * models with /model." and the seat then did nothing for nine minutes, while
 * the engine reported booted: true, all five seats alive: true, and the
 * delivery stamped "verified in 254ms" — because the mail genuinely DID land;
 * the model simply never acted on it. The process is alive, so every
 * process-shaped check says healthy. Liveness is about USABILITY, not aliveness.
 *
 * This is the same family as the run #12 auth-stale finding above (harness up,
 * every request 401s), which is why both are decided here by one scanner.
 */
export declare const USAGE_LIMIT_RE: RegExp;
/**
 * A pane's bytes are raw ANSI. Strip in THIS order or the text is unreadable:
 * kitty graphics first (its payload is base64 that otherwise survives as noise
 * and can itself contain sequence-looking bytes), then OSC, then CSI.
 */
export declare function normalizePaneText(raw: string | Buffer): string;
/** How much of the pane's END counts as "what the seat is stuck on". */
export declare const PANE_TAIL_CHARS = 2000;
/**
 * Why a seat that LOOKS alive is not usable — or undefined if nothing is wrong.
 *
 * Deliberately reads only the pane's TAIL, and that is the whole defence
 * against a nasty false positive: a seat is perfectly capable of DISCUSSING
 * usage limits — reviewing rate-limit code, writing an error message, reading
 * this very file — and a naive whole-pane scan would declare a hard-working
 * seat usage-limited. A seat that is still working produces output AFTER
 * whatever it was discussing, so the banner drops out of the tail. A seat that
 * is genuinely stuck on the refusal has it as its last word.
 *
 * In other words: SILENCE is the detector, the banner only NAMES the cause.
 */
export declare function paneUsability(raw: string | Buffer | undefined): {
    liveness: Liveness;
    detail: string;
} | undefined;
export interface SeatHealth {
    seat: Seat;
    title: string;
    agent: string;
    model: string;
    liveness: Liveness;
    /** Plain-words basis for the liveness verdict (incl. why "unknown"). */
    detail: string;
    /** Seconds since the seat's state file changed (absent = no state file). */
    stateFileAgeSec?: number;
}
/** rig.conf AUTO_REVIVE opt-in (default OFF). */
export declare function autoReviveEnabled(projectRoot: string): boolean;
export interface ReviveNote {
    seat: Seat;
    at: string;
    count: number;
    stopped?: boolean;
    detail: string;
}
/**
 * The auto-revive policy, as a pure injectable unit (the P5-7 lesson: revive
 * machinery must be regression-testable without a live transport):
 * - Only liveness === "dead" is ever revived. "unknown" is fail-safe-live
 *   (a flaky read must never trigger a relaunch) and "signed-out" needs a
 *   human decision (stale auth can loop forever).
 * - Backoff doubles per attempt (base 60s; the first revive is immediate).
 * - CEILING (default 3): a seat that keeps dying gets ONE honest "stopping —
 *   check the seat" note and is left alone; the manual Relaunch stays. A seat
 *   seen LIVE again resets its episode.
 * In headless (T8) the injected `revive` relaunches the seat's runner CHILD
 * via gui/teamproc.ts (was: recreate a cmux pane).
 */
export declare function makeAutoReviver(opts: {
    revive: (seat: Seat, workspace: string) => Promise<unknown>;
    ceiling?: number;
    baseBackoffMs?: number;
    now?: () => number;
}): {
    tick: (seats: SeatHealth[], workspace: string) => Promise<ReviveNote[]>;
};
