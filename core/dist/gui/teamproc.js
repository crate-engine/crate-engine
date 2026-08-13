// PHASE-8 T7-3 — the team lifecycle manager: the GUI OWNS the headless team.
// Until now the team ran as a separate `crate team` process; the GUI was a
// pure viewer. T7-3 lets the GUI boot, stop, and per-seat relaunch the runners
// so the Team menu's actions are real and `crate open` can boot headless
// without cmux. One SUPERVISED child per seat (D9: "the runner IS the
// supervisor") — so relaunching one seat restarts exactly that runner, never
// the whole team. No new coordination: each child is `crate runner <seat>`,
// the same loop `crate team` runs; killing/respawning is process lifecycle.
//
// BLENDED PANE (PDR blended-pane, S2): boot() now branches per seat. A seat
// flagged BLEND_<PREFIX>=1 in rig.conf whose staffed agent has a live-
// verified blend shape runs IN-PROCESS as a BlendedSeat (the PTY registry is
// GUI-server state — a runner child could never reach the pane); everything
// else keeps the runner-child path byte-identical. A flagged-but-ineligible
// seat FAILS OPEN to the proven headless path with an honest stamp — never a
// dead seat.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { blendEligible, isBlended } from "../blend.js";
import { sessionFile, turnsDir } from "../runner.js";
import { parseRigConf, RIG_PREFIX } from "../staffing.js";
import { SEATS } from "../manifest.js";
export { defaultBlendStarter } from "../blendseat.js";
/** The default spawner: `node <cli.js> runner <seat> --project <root>`.
 * Runner black box (FLAWS 2026-08-11): four runners died silently on a
 * relaunch and stdio:"ignore" left NOTHING to diagnose — the gui.log lesson,
 * runner edition. With `home`, each runner's stdout/stderr lands in
 * ~/.crate/logs/runners/<seat>.log, spawn and death are stamped there, and a
 * non-zero exit also lands in gui.log so the supervisor's record shows it. */
export function defaultSeatSpawner(cliPath, home) {
    return (seat, projectRoot) => {
        let fd = "ignore";
        let logPath;
        if (home) {
            try {
                logPath = join(home, ".crate", "logs", "runners", `${seat}.log`);
                mkdirSync(dirname(logPath), { recursive: true });
                fd = openSync(logPath, "a");
                appendFileSync(logPath, `[${new Date().toISOString()}] spawn — runner ${seat} on ${projectRoot}\n`);
            }
            catch {
                fd = "ignore"; // a broken log dir never blocks the team
            }
        }
        const child = spawn(process.execPath, [cliPath, "runner", seat, "--project", projectRoot], {
            cwd: projectRoot,
            stdio: ["ignore", fd, fd],
            detached: false, // dies with the GUI (the GUI is the supervisor now)
            // runner-deaths fix (FLAWS 2026-08-11): tell the child WHO its supervisor
            // is, fixed before it even starts. The runner's ppid watchdog used to
            // capture ppid at loop start (~1-3s after spawn: node boot + wall render);
            // a supervisor dying inside that window meant the runner captured the
            // REPARENTED ppid (init) and could never notice the death — the immortal
            // orphan. Comparing against this env value closes the race.
            env: { ...process.env, CRATE_SUPERVISOR_PID: String(process.pid) },
        });
        if (logPath) {
            const lp = logPath;
            child.on("exit", (code, sig) => {
                try {
                    appendFileSync(lp, `[${new Date().toISOString()}] EXIT code=${code} signal=${sig ?? "none"} (pid ${child.pid})\n`);
                    if (code !== 0 && home) {
                        appendFileSync(join(home, ".crate", "logs", "gui.log"), `[${new Date().toISOString()}] runner ${seat} DIED code=${code} signal=${sig ?? "none"} — see logs/runners/${seat}.log\n`);
                    }
                }
                catch {
                    /* forensics only */
                }
            });
        }
        return child;
    };
}
/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat — or an in-process blended supervisor for flagged seats; stop
 * kills them; relaunch restarts exactly one. State is the live child handles
 * — the process table (and the blend map) is the truth, no pid files.
 */
export class TeamProcess {
    projectRoot;
    spawner;
    blendStarter;
    procs = new Map();
    blends = new Map();
    constructor(projectRoot, spawner, blendStarter) {
        this.projectRoot = projectRoot;
        this.spawner = spawner;
        this.blendStarter = blendStarter;
    }
    /** True once any seat has been booted and at least one child is alive. */
    get booted() {
        for (const p of this.procs.values())
            if (p.child.exitCode === null && !p.child.killed)
                return true;
        for (const b of this.blends.values())
            if (b.alive())
                return true;
        return false;
    }
    stamp(seat, line) {
        try {
            appendFileSync(join(turnsDir(this.projectRoot, seat), "turns.log"), `${new Date().toISOString()} | ${line}\n`);
        }
        catch {
            /* the launch matters more than the note */
        }
    }
    spawnSeat(seat) {
        const child = this.spawner(seat, this.projectRoot);
        this.procs.set(seat, { seat, child, startedAt: Date.now() });
        // Reap the handle on exit so `alive` is honest (a crashed runner is dead,
        // not phantom-alive). AUTO_REVIVE stays the runner's own opt-in concern.
        child.on("exit", () => {
            const cur = this.procs.get(seat);
            if (cur && cur.child === child)
                this.procs.set(seat, { ...cur }); // keep record; alive() reads exitCode
        });
    }
    /** THE branch point: blended vs runner child, decided fresh from rig.conf
     * every launch (a restaff or flag edit takes effect on the next relaunch).
     * Kills/stops whatever currently runs for the seat first. */
    launchSeat(seat) {
        const b = this.blends.get(seat);
        if (b) {
            b.stop();
            this.blends.delete(seat);
        }
        const cur = this.procs.get(seat);
        if (cur && cur.child.exitCode === null && !cur.child.killed)
            cur.child.kill("SIGTERM");
        this.procs.delete(seat);
        let conf = {};
        try {
            conf = parseRigConf(readFileSync(join(this.projectRoot, ".agents", "rig.conf"), "utf8"));
        }
        catch {
            /* boot() already required rig.conf; a race falls back to headless */
        }
        // S4 (blend = the default): an eligible, not-opted-out seat blends; the
        // headless runner survives ONLY as the invisible fallback for agents
        // without a live-probed TUI shape (and for explicit BLEND_<PREFIX>=0
        // opt-outs). Fail open to the proven path, never a dead seat.
        const agent = conf[`${RIG_PREFIX[seat]}_AGENT`] || "pi";
        if (this.blendStarter && isBlended(conf, seat, agent)) {
            this.blends.set(seat, this.blendStarter(seat, this.projectRoot));
            return;
        }
        if (this.blendStarter && conf[`BLEND_${RIG_PREFIX[seat]}`] !== "0") {
            const el = blendEligible(agent);
            if (!el.ok)
                this.stamp(seat, `${el.reason} — seat runs on the headless fallback`);
        }
        this.spawnSeat(seat);
    }
    seatAlive(seat) {
        const b = this.blends.get(seat);
        if (b)
            return b.alive();
        const p = this.procs.get(seat);
        return !!p && p.child.exitCode === null && !p.child.killed;
    }
    /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
    boot() {
        if (!existsSync(join(this.projectRoot, ".agents", "rig.conf"))) {
            throw new Error(`no rig.conf at ${this.projectRoot} — attach the project before booting the team.`);
        }
        for (const seat of SEATS) {
            if (!this.seatAlive(seat))
                this.launchSeat(seat);
        }
        return this.status();
    }
    /** Restart exactly one seat (the Team menu's per-seat Relaunch). Re-reads
     * rig.conf, so a restaffed or re-flagged seat lands on the right path. */
    relaunch(seat) {
        this.launchSeat(seat);
        return this.status();
    }
    /** D12 refresh, blended form: the refresh IS a visible restart of the live
     * pane. Refused mid-response (a fresh session that tore a running turn in
     * half would lose work — the impeccable-context law); force overrides.
     * Non-blended seats return handled:false — the caller falls through to the
     * headless refreshSeat path. */
    refreshBlended(seat, opts = {}) {
        const b = this.blends.get(seat);
        if (!b || !b.alive())
            return { handled: false };
        if (!opts.force && b.responding()) {
            return {
                handled: true,
                ok: false,
                reason: `${seat} is mid-response in its live pane — a refresh now would tear the turn in half. ` +
                    `Wait for it to go quiet, or force to override.`,
            };
        }
        try {
            rmSync(sessionFile(this.projectRoot, seat));
        }
        catch {
            /* already fresh */
        }
        this.stamp(seat, `refreshed (blended${opts.force ? ", forced" : ""}) | session dropped — respawning the pane fresh, visibly`);
        this.launchSeat(seat); // sessionFile is gone → the new pane opens fresh, on screen
        return { handled: true, ok: true };
    }
    /** Stop the whole team (SIGTERM every runner; stop every blended seat). */
    stop() {
        for (const p of this.procs.values()) {
            if (p.child.exitCode === null && !p.child.killed)
                p.child.kill("SIGTERM");
        }
        for (const b of this.blends.values())
            b.stop();
        return this.status();
    }
    status() {
        const seats = SEATS.map((seat) => {
            const b = this.blends.get(seat);
            if (b) {
                // A blended seat has no runner pid — its loop lives in THIS process.
                return { seat, alive: b.alive(), pid: null, startedAt: b.startedAt, mode: "blended" };
            }
            const p = this.procs.get(seat);
            const alive = !!p && p.child.exitCode === null && !p.child.killed;
            return { seat, alive, pid: p?.child.pid ?? null, startedAt: p?.startedAt ?? null };
        });
        return { booted: this.booted, seats };
    }
}
// One TeamProcess per project root, shared across requests in the GUI process.
const registry = new Map();
export function teamProcessFor(projectRoot, spawner, blendStarter) {
    let tp = registry.get(projectRoot);
    if (!tp) {
        tp = new TeamProcess(projectRoot, spawner, blendStarter);
        registry.set(projectRoot, tp);
    }
    return tp;
}
/** Test/shutdown helper: drop all supervised teams (kills their seats). */
export function stopAllTeams() {
    for (const tp of registry.values())
        tp.stop();
    registry.clear();
}
/** The /api/restart handoff (runner-deaths fix, FLAWS 2026-08-11): stop every
 * team while THIS process is still alive — so the runners die by
 * parent-delivered SIGTERM and the parent's EXIT handlers actually get to
 * write their stamps (the old restart just process.exit(0)'d, orphaning the
 * children to silent code-0 watchdog deaths with no forensic trail). Returns
 * what was running so the caller can tell the fresh server to boot it back. */
export function handoffStop() {
    let wasBooted = false;
    let stopped = 0;
    for (const tp of registry.values()) {
        const st = tp.status();
        if (st.booted)
            wasBooted = true;
        stopped += st.seats.filter((s) => s.alive).length;
        tp.stop();
    }
    registry.clear();
    return { wasBooted, stopped };
}
//# sourceMappingURL=teamproc.js.map