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
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { blendEligible, isBlended } from "../blend.js";
import { sessionFile, turnsDir } from "../runner.js";
import { parseRigConf, RIG_PREFIX } from "../staffing.js";
import { SEATS, type Seat } from "../manifest.js";
import { defaultBlendStarter, type BlendedSeatHandle } from "../blendseat.js";

export { defaultBlendStarter } from "../blendseat.js";

/** CE-140 (found by the CE-135 fix's own test, 2026-08-18): aliveness must
 * account for SIGNAL deaths. Node leaves `exitCode` null when a child dies
 * by signal (`signalCode` carries it) and `killed` marks only handle-
 * initiated kills — so `exitCode === null && !killed` read a SIGKILLed
 * runner as ALIVE forever (phantom-alive; the 2026-08-11 deaths were
 * code-0 exits, which is why this never surfaced). One truth, used
 * everywhere: not exited by code, not exited by signal, not killed by us. */
function childAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

export interface SeatProc {
  seat: Seat;
  child: ChildProcess;
  startedAt: number;
}

/** A launcher for one seat's runner — injectable so tests use a stub. */
export type SeatSpawner = (seat: Seat, projectRoot: string) => ChildProcess;

/** A launcher for one blended seat's in-process supervisor — injectable so
 * tests drive the branch without a real PTY. */
export type BlendStarter = (seat: Seat, projectRoot: string) => BlendedSeatHandle;

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
  seats: Array<{ seat: Seat; alive: boolean; pid: number | null; startedAt: number | null; mode?: "blended" }>;
}

/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat — or an in-process blended supervisor for flagged seats; stop
 * kills them; relaunch restarts exactly one. State is the live child handles
 * — the process table (and the blend map) is the truth, no pid files.
 */
export class TeamProcess {
  private procs = new Map<Seat, SeatProc>();
  private blends = new Map<Seat, BlendedSeatHandle>();
  constructor(
    readonly projectRoot: string,
    private readonly spawner: SeatSpawner,
    private blendStarter?: BlendStarter, // mutable — see adoptBlendStarter
  ) {}

  /** Late-bind the blend starter (the five-dead-seats fix, 2026-08-13): the
   * registry memoizes the FIRST instance per project, and the restart
   * handoff's --boot path once created it starter-less — every later boot
   * through the cached instance then spawned runner children that S4's
   * double-consumer refusal killed on sight: five dead seats, and the Team
   * menu could not recover because it kept reaching the same cached
   * instance. Any caller that HAS a starter now upgrades the instance. */
  adoptBlendStarter(bs: BlendStarter): void {
    this.blendStarter ??= bs;
  }

  /** True once any seat has been booted and at least one child is alive. */
  get booted(): boolean {
    for (const p of this.procs.values()) if (childAlive(p.child)) return true;
    for (const b of this.blends.values()) if (b.alive()) return true;
    return false;
  }

  private stamp(seat: Seat, line: string): void {
    try {
      appendFileSync(join(turnsDir(this.projectRoot, seat), "turns.log"), `${new Date().toISOString()} | ${line}\n`);
    } catch {
      /* the launch matters more than the note */
    }
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

  /** THE branch point: blended vs runner child, decided fresh from rig.conf
   * every launch (a restaff or flag edit takes effect on the next relaunch).
   * Kills/stops whatever currently runs for the seat first. */
  private launchSeat(seat: Seat): void {
    const b = this.blends.get(seat);
    if (b) {
      b.stop();
      this.blends.delete(seat);
    }
    const cur = this.procs.get(seat);
    if (cur && childAlive(cur.child)) cur.child.kill("SIGTERM");
    this.procs.delete(seat);

    let conf: Record<string, string> = {};
    try {
      conf = parseRigConf(readFileSync(join(this.projectRoot, ".agents", "rig.conf"), "utf8"));
    } catch {
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
      if (!el.ok) this.stamp(seat, `${el.reason} — seat runs on the headless fallback`);
    }
    this.spawnSeat(seat);
  }

  private seatAlive(seat: Seat): boolean {
    const b = this.blends.get(seat);
    if (b) return b.alive();
    const p = this.procs.get(seat);
    return !!p && childAlive(p.child);
  }

  /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
  boot(): TeamProcStatus {
    if (!existsSync(join(this.projectRoot, ".agents", "rig.conf"))) {
      throw new Error(`no rig.conf at ${this.projectRoot} — attach the project before booting the team.`);
    }
    for (const seat of SEATS) {
      if (!this.seatAlive(seat)) this.launchSeat(seat);
    }
    return this.status();
  }

  /** Restart exactly one seat (the Team menu's per-seat Relaunch). Re-reads
   * rig.conf, so a restaffed or re-flagged seat lands on the right path. */
  relaunch(seat: Seat): TeamProcStatus {
    this.launchSeat(seat);
    return this.status();
  }

  /** D12 refresh, blended form: the refresh IS a visible restart of the live
   * pane. Refused mid-response (a fresh session that tore a running turn in
   * half would lose work — the impeccable-context law); force overrides.
   * Non-blended seats return handled:false — the caller falls through to the
   * headless refreshSeat path. */
  refreshBlended(seat: Seat, opts: { force?: boolean } = {}): { handled: boolean; ok?: boolean; reason?: string } {
    const b = this.blends.get(seat);
    if (!b || !b.alive()) return { handled: false };
    if (!opts.force && b.responding()) {
      return {
        handled: true,
        ok: false,
        reason:
          `${seat} is mid-response in its live pane — a refresh now would tear the turn in half. ` +
          `Wait for it to go quiet, or force to override.`,
      };
    }
    try {
      rmSync(sessionFile(this.projectRoot, seat));
    } catch {
      /* already fresh */
    }
    this.stamp(seat, `refreshed (blended${opts.force ? ", forced" : ""}) | session dropped — respawning the pane fresh, visibly`);
    this.launchSeat(seat); // sessionFile is gone → the new pane opens fresh, on screen
    return { handled: true, ok: true };
  }

  /** Park exactly ONE seat, deliberately and visibly (the lifecycle PDR's
   * opt-in idle knob — workers only; the caller enforces never-the-
   * orchestrator). The stamp lands BEFORE the stop so the record says why;
   * the seat then reads as unstaffed (a calm invitation), never as dead. */
  parkSeat(seat: Seat, note: string): void {
    this.stamp(seat, note);
    const b = this.blends.get(seat);
    if (b) {
      b.stop();
      this.blends.delete(seat);
    }
    const p = this.procs.get(seat);
    if (p && childAlive(p.child)) p.child.kill("SIGTERM");
    this.procs.delete(seat); // no corpse record — parked is an invitation, not distress
  }

  /** Stop the whole team (SIGTERM every runner; stop every blended seat).
   * CE-135 (battle test 2026-08-18): every stop() call site is DELIBERATE
   * (scoped park, operator stop, shutdown handoff) — so the seat records
   * clear, same as parkSeat: a parked workspace must read as calm
   * invitations, never as died-with-a-startedAt. A CRASHED seat keeps its
   * record (stop never ran for it) and stays the downchip's distress. */
  stop(): TeamProcStatus {
    for (const p of this.procs.values()) {
      if (childAlive(p.child)) p.child.kill("SIGTERM");
    }
    for (const b of this.blends.values()) b.stop();
    const st = this.status(); // report what was stopped…
    this.procs.clear(); // …then no corpse records: parked is an invitation
    this.blends.clear();
    return st;
  }

  status(): TeamProcStatus {
    const seats = SEATS.map((seat) => {
      const b = this.blends.get(seat);
      if (b) {
        // A blended seat has no runner pid — its loop lives in THIS process.
        return { seat, alive: b.alive(), pid: null, startedAt: b.startedAt, mode: "blended" as const };
      }
      const p = this.procs.get(seat);
      const alive = !!p && childAlive(p.child);
      return { seat, alive, pid: p?.child.pid ?? null, startedAt: p?.startedAt ?? null };
    });
    return { booted: this.booted, seats };
  }
}

// One TeamProcess per project root, shared across requests in the GUI process.
const registry = new Map<string, TeamProcess>();

export function teamProcessFor(projectRoot: string, spawner: SeatSpawner, blendStarter?: BlendStarter): TeamProcess {
  let tp = registry.get(projectRoot);
  if (!tp) {
    tp = new TeamProcess(projectRoot, spawner, blendStarter);
    registry.set(projectRoot, tp);
  } else if (blendStarter) {
    tp.adoptBlendStarter(blendStarter); // a starter-less cached instance upgrades, never sticks
  }
  return tp;
}

/** Read one team's status WITHOUT creating a supervisor (the workspace
 * rail's live-count read — a peek must never instantiate lifecycle). */
export function peekTeam(projectRoot: string): TeamProcStatus | undefined {
  return registry.get(projectRoot)?.status();
}

/** The idle knob's minutes from rig.conf — undefined = OFF (the default:
 * cmux never reaps your idle terminals; a team runs until Adam parks it). */
export function idleParkMinutes(conf: Record<string, string>): number | undefined {
  const v = Number(conf.IDLE_PARK_MIN);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** PURE: which seats the idle knob parks right now. Workers only — NEVER
 * the orchestrator (the PDR's invariant: it holds the loop's context).
 * Guards: the knob must be set; the rig must have been quiet for the whole
 * window (newest turns.log mtime); and each candidate must have been UP at
 * least that long (a just-booted team with no turns yet gets its grace). */
export function idleParkTargets(
  st: TeamProcStatus,
  idleMin: number | undefined,
  lastActivityMs: number | null,
  now: number,
): Seat[] {
  if (idleMin === undefined) return [];
  const windowMs = idleMin * 60_000;
  if (lastActivityMs !== null && now - lastActivityMs < windowMs) return [];
  return st.seats
    .filter((s) => s.alive && s.seat !== "orchestrator" && s.startedAt !== null && now - s.startedAt >= windowMs)
    .map((s) => s.seat);
}

/** Test/shutdown helper: drop all supervised teams (kills their seats). */
export function stopAllTeams(): void {
  for (const tp of registry.values()) tp.stop();
  registry.clear();
}

/** The /api/restart handoff (runner-deaths fix, FLAWS 2026-08-11): stop every
 * team while THIS process is still alive — so the runners die by
 * parent-delivered SIGTERM and the parent's EXIT handlers actually get to
 * write their stamps (the old restart just process.exit(0)'d, orphaning the
 * children to silent code-0 watchdog deaths with no forensic trail). Returns
 * what was running so the caller can tell the fresh server to boot it back. */
export function handoffStop(): { wasBooted: boolean; stopped: number } {
  let wasBooted = false;
  let stopped = 0;
  for (const tp of registry.values()) {
    const st = tp.status();
    if (st.booted) wasBooted = true;
    stopped += st.seats.filter((s) => s.alive).length;
    tp.stop();
  }
  registry.clear();
  return { wasBooted, stopped };
}
