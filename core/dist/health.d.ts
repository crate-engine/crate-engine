import type { Seat } from "./manifest.js";
export type Liveness = "live" | "signed-out" | "dead" | "unknown";
/**
 * Run #12 finding: a long-running claude seat's OAuth token can go stale
 * (overnight) — the harness keeps running but every request 401s, and an
 * in-session /login does NOT recover it (only a relaunch re-reads the
 * keychain). These markers flag a seat "signed-out" so the UI can offer
 * Relaunch. (Kept for the turn-log scan; liveness ≠ usability.)
 */
export declare const AUTH_STALE_RE: RegExp;
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
