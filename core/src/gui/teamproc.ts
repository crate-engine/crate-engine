// PHASE-8 T7-3 — the team lifecycle manager: the GUI OWNS the headless team.
// Until now the team ran as a separate `crate team` process; the GUI was a
// pure viewer. T7-3 lets the GUI boot, stop, and per-seat relaunch the runners
// so the Team menu's actions are real and `crate open` can boot headless
// without cmux. One SUPERVISED child per seat (D9: "the runner IS the
// supervisor") — so relaunching one seat restarts exactly that runner, never
// the whole team. No new coordination: each child is `crate runner <seat>`,
// the same loop `crate team` runs; killing/respawning is process lifecycle.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { SEATS, type Seat } from "../manifest.js";

export interface SeatProc {
  seat: Seat;
  child: ChildProcess;
  startedAt: number;
}

/** A launcher for one seat's runner — injectable so tests use a stub. */
export type SeatSpawner = (seat: Seat, projectRoot: string) => ChildProcess;

/** The default spawner: `node <cli.js> runner <seat> --project <root>`.
 * Runner black box (FLAWS 2026-08-11): four runners died silently on a
 * relaunch and stdio:"ignore" left NOTHING to diagnose — the gui.log lesson,
 * runner edition. With `home`, each runner's stdout/stderr lands in
 * ~/.crate/logs/runners/<seat>.log, spawn and death are stamped there, and a
 * non-zero exit also lands in gui.log so the supervisor's record shows it. */
export function defaultSeatSpawner(cliPath: string, home?: string): SeatSpawner {
  return (seat, projectRoot) => {
    let fd: number | "ignore" = "ignore";
    let logPath: string | undefined;
    if (home) {
      try {
        logPath = join(home, ".crate", "logs", "runners", `${seat}.log`);
        mkdirSync(dirname(logPath), { recursive: true });
        fd = openSync(logPath, "a");
        appendFileSync(logPath, `[${new Date().toISOString()}] spawn — runner ${seat} on ${projectRoot}\n`);
      } catch {
        fd = "ignore"; // a broken log dir never blocks the team
      }
    }
    const child = spawn(process.execPath, [cliPath, "runner", seat, "--project", projectRoot], {
      cwd: projectRoot,
      stdio: ["ignore", fd, fd],
      detached: false, // dies with the GUI (the GUI is the supervisor now)
    });
    if (logPath) {
      const lp = logPath;
      child.on("exit", (code, sig) => {
        try {
          appendFileSync(lp, `[${new Date().toISOString()}] EXIT code=${code} signal=${sig ?? "none"} (pid ${child.pid})\n`);
          if (code !== 0 && home) {
            appendFileSync(join(home, ".crate", "logs", "gui.log"), `[${new Date().toISOString()}] runner ${seat} DIED code=${code} signal=${sig ?? "none"} — see logs/runners/${seat}.log\n`);
          }
        } catch {
          /* forensics only */
        }
      });
    }
    return child;
  };
}

export interface TeamProcStatus {
  booted: boolean;
  seats: Array<{ seat: Seat; alive: boolean; pid: number | null; startedAt: number | null }>;
}

/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat; stop kills them; relaunch restarts exactly one. State is the live
 * child handles — the process table is the truth, no pid files.
 */
export class TeamProcess {
  private procs = new Map<Seat, SeatProc>();
  constructor(
    readonly projectRoot: string,
    private readonly spawner: SeatSpawner,
  ) {}

  /** True once any seat has been booted and at least one child is alive. */
  get booted(): boolean {
    for (const p of this.procs.values()) if (p.child.exitCode === null && !p.child.killed) return true;
    return false;
  }

  private spawnSeat(seat: Seat): void {
    const child = this.spawner(seat, this.projectRoot);
    this.procs.set(seat, { seat, child, startedAt: Date.now() });
    // Reap the handle on exit so `alive` is honest (a crashed runner is dead,
    // not phantom-alive). AUTO_REVIVE stays the runner's own opt-in concern.
    child.on("exit", () => {
      const cur = this.procs.get(seat);
      if (cur && cur.child === child) this.procs.set(seat, { ...cur }); // keep record; alive() reads exitCode
    });
  }

  /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
  boot(): TeamProcStatus {
    if (!existsSync(join(this.projectRoot, ".agents", "rig.conf"))) {
      throw new Error(`no rig.conf at ${this.projectRoot} — attach the project before booting the team.`);
    }
    for (const seat of SEATS) {
      const cur = this.procs.get(seat);
      const alive = cur && cur.child.exitCode === null && !cur.child.killed;
      if (!alive) this.spawnSeat(seat);
    }
    return this.status();
  }

  /** Restart exactly one seat's runner (the Team menu's per-seat Relaunch). */
  relaunch(seat: Seat): TeamProcStatus {
    const cur = this.procs.get(seat);
    if (cur && cur.child.exitCode === null) cur.child.kill("SIGTERM");
    this.spawnSeat(seat);
    return this.status();
  }

  /** Stop the whole team (SIGTERM every seat). */
  stop(): TeamProcStatus {
    for (const p of this.procs.values()) {
      if (p.child.exitCode === null && !p.child.killed) p.child.kill("SIGTERM");
    }
    return this.status();
  }

  status(): TeamProcStatus {
    const seats = SEATS.map((seat) => {
      const p = this.procs.get(seat);
      const alive = !!p && p.child.exitCode === null && !p.child.killed;
      return { seat, alive, pid: p?.child.pid ?? null, startedAt: p?.startedAt ?? null };
    });
    return { booted: this.booted, seats };
  }
}

// One TeamProcess per project root, shared across requests in the GUI process.
const registry = new Map<string, TeamProcess>();

export function teamProcessFor(projectRoot: string, spawner: SeatSpawner): TeamProcess {
  let tp = registry.get(projectRoot);
  if (!tp) {
    tp = new TeamProcess(projectRoot, spawner);
    registry.set(projectRoot, tp);
  }
  return tp;
}

/** Test/shutdown helper: drop all supervised teams (kills their seats). */
export function stopAllTeams(): void {
  for (const tp of registry.values()) tp.stop();
  registry.clear();
}
