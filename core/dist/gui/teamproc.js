// PHASE-8 T7-3 — the team lifecycle manager: the GUI OWNS the headless team.
// Until now the team ran as a separate `crate team` process; the GUI was a
// pure viewer. T7-3 lets the GUI boot, stop, and per-seat relaunch the runners
// so the Team menu's actions are real and `crate open` can boot headless
// without cmux. One SUPERVISED child per seat (D9: "the runner IS the
// supervisor") — so relaunching one seat restarts exactly that runner, never
// the whole team. No new coordination: each child is `crate runner <seat>`,
// the same loop `crate team` runs; killing/respawning is process lifecycle.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SEATS } from "../manifest.js";
/** The default spawner: `node <cli.js> runner <seat> --project <root>`. */
export function defaultSeatSpawner(cliPath) {
    return (seat, projectRoot) => spawn(process.execPath, [cliPath, "runner", seat, "--project", projectRoot], {
        cwd: projectRoot,
        stdio: "ignore",
        detached: false, // dies with the GUI (the GUI is the supervisor now)
    });
}
/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat; stop kills them; relaunch restarts exactly one. State is the live
 * child handles — the process table is the truth, no pid files.
 */
export class TeamProcess {
    projectRoot;
    spawner;
    procs = new Map();
    constructor(projectRoot, spawner) {
        this.projectRoot = projectRoot;
        this.spawner = spawner;
    }
    /** True once any seat has been booted and at least one child is alive. */
    get booted() {
        for (const p of this.procs.values())
            if (p.child.exitCode === null && !p.child.killed)
                return true;
        return false;
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
    /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
    boot() {
        if (!existsSync(join(this.projectRoot, ".agents", "rig.conf"))) {
            throw new Error(`no rig.conf at ${this.projectRoot} — attach the project before booting the team.`);
        }
        for (const seat of SEATS) {
            const cur = this.procs.get(seat);
            const alive = cur && cur.child.exitCode === null && !cur.child.killed;
            if (!alive)
                this.spawnSeat(seat);
        }
        return this.status();
    }
    /** Restart exactly one seat's runner (the Team menu's per-seat Relaunch). */
    relaunch(seat) {
        const cur = this.procs.get(seat);
        if (cur && cur.child.exitCode === null)
            cur.child.kill("SIGTERM");
        this.spawnSeat(seat);
        return this.status();
    }
    /** Stop the whole team (SIGTERM every seat). */
    stop() {
        for (const p of this.procs.values()) {
            if (p.child.exitCode === null && !p.child.killed)
                p.child.kill("SIGTERM");
        }
        return this.status();
    }
    status() {
        const seats = SEATS.map((seat) => {
            const p = this.procs.get(seat);
            const alive = !!p && p.child.exitCode === null && !p.child.killed;
            return { seat, alive, pid: p?.child.pid ?? null, startedAt: p?.startedAt ?? null };
        });
        return { booted: this.booted, seats };
    }
}
// One TeamProcess per project root, shared across requests in the GUI process.
const registry = new Map();
export function teamProcessFor(projectRoot, spawner) {
    let tp = registry.get(projectRoot);
    if (!tp) {
        tp = new TeamProcess(projectRoot, spawner);
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
//# sourceMappingURL=teamproc.js.map