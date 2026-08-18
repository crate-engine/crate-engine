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
export const USAGE_LIMIT_RE = /reached your [^\n]{0,40}limit|usage limit reached|\/usage-credits|out of (?:usage )?credits|RESOURCE_EXHAUSTED|quota exceeded/i;
/**
 * A pane's bytes are raw ANSI. Strip in THIS order or the text is unreadable:
 * kitty graphics first (its payload is base64 that otherwise survives as noise
 * and can itself contain sequence-looking bytes), then OSC, then CSI.
 */
export function normalizePaneText(raw) {
    const s = typeof raw === "string" ? raw : raw.toString("utf8");
    return s
        .replace(/\x1b_G.*?\x1b\\/gs, "")
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
/** How much of the pane's END counts as "what the seat is stuck on". */
export const PANE_TAIL_CHARS = 2000;
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
export function paneUsability(raw) {
    if (raw === undefined || raw.length === 0)
        return undefined;
    const text = normalizePaneText(raw);
    const tail = text.slice(-PANE_TAIL_CHARS);
    if (USAGE_LIMIT_RE.test(tail)) {
        return {
            liveness: "usage-limited",
            detail: "model unavailable — the pane's last output is a usage/quota limit; the seat is alive but cannot work (top up, or staff a different model)",
        };
    }
    if (AUTH_STALE_RE.test(tail)) {
        return {
            liveness: "signed-out",
            detail: "signed out — the pane's last output is an auth failure; an in-session /login does NOT recover it, relaunch the seat",
        };
    }
    return undefined;
}
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