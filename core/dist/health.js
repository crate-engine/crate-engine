// Team health + auto-revive policy. T8: the cmux read-screen liveness
// (teamHealth/reviveSeat/findWorkspace/refreshTeam) was removed with cmux —
// the GUI-owned team lifecycle (gui/teamproc.ts) is the liveness source now
// (a live runner CHILD = live; an exited child = dead). What remains here is
// the transport-agnostic policy: the SeatHealth shape, the AUTH-stale marker,
// and the auto-revive backoff/ceiling monitor (a pure, injectable unit).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Run #12 finding: a long-running claude seat's OAuth token can go stale
 * (overnight) — the harness keeps running but every request 401s, and an
 * in-session /login does NOT recover it (only a relaunch re-reads the
 * keychain). These markers flag a seat "signed-out" so the UI can offer
 * Relaunch. (Kept for the turn-log scan; liveness ≠ usability.)
 */
export const AUTH_STALE_RE = /API Error: 401|Invalid authentication credentials|OAuth token has expired/;
/** rig.conf AUTO_REVIVE opt-in (default OFF). */
export function autoReviveEnabled(projectRoot) {
    const conf = join(projectRoot, ".agents", "rig.conf");
    if (!existsSync(conf))
        return false;
    const m = readFileSync(conf, "utf8").match(/^\s*AUTO_REVIVE="?([^"\n]*)"?\s*$/m);
    const v = (m?.[1] ?? "").trim().toLowerCase();
    return v !== "" && !["0", "false", "no", "off"].includes(v);
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
export function makeAutoReviver(opts) {
    const ceiling = opts.ceiling ?? 3;
    const base = opts.baseBackoffMs ?? 60_000;
    const now = opts.now ?? (() => Date.now());
    const episodes = new Map();
    return {
        async tick(seats, workspace) {
            const notes = [];
            for (const s of seats) {
                if (s.liveness !== "dead") {
                    if (s.liveness === "live")
                        episodes.delete(s.seat); // healthy again → fresh episode next time
                    continue;
                }
                const e = episodes.get(s.seat) ?? { count: 0, last: 0, stoppedNoted: false };
                episodes.set(s.seat, e);
                if (e.count >= ceiling) {
                    if (!e.stoppedNoted) {
                        e.stoppedNoted = true;
                        notes.push({
                            seat: s.seat,
                            at: new Date(now()).toISOString(),
                            count: e.count,
                            stopped: true,
                            detail: `auto-revived ${e.count}× and it died again — auto-revive STOPPED for this seat; check it (the Relaunch button stays available)`,
                        });
                    }
                    continue;
                }
                if (e.count > 0 && now() - e.last < base * 2 ** e.count)
                    continue; // backoff
                try {
                    await opts.revive(s.seat, workspace);
                    e.count += 1;
                    e.last = now();
                    notes.push({
                        seat: s.seat,
                        at: new Date(now()).toISOString(),
                        count: e.count,
                        detail: `auto-revived (${e.count}/${ceiling})`,
                    });
                }
                catch (err) {
                    e.count += 1;
                    e.last = now();
                    notes.push({
                        seat: s.seat,
                        at: new Date(now()).toISOString(),
                        count: e.count,
                        detail: `auto-revive attempt ${e.count}/${ceiling} FAILED: ${err instanceof Error ? err.message : err}`,
                    });
                }
            }
            return notes;
        },
    };
}
//# sourceMappingURL=health.js.map