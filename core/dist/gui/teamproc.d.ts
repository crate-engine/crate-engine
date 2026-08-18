import { type ChildProcess } from "node:child_process";
import { type Seat } from "../manifest.js";
import { type BlendedSeatHandle } from "../blendseat.js";
export { defaultBlendStarter } from "../blendseat.js";
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
export declare function defaultSeatSpawner(cliPath: string, home?: string): SeatSpawner;
export interface TeamProcStatus {
    booted: boolean;
    seats: Array<{
        seat: Seat;
        alive: boolean;
        pid: number | null;
        startedAt: number | null;
        mode?: "blended";
    }>;
}
/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat — or an in-process blended supervisor for flagged seats; stop
 * kills them; relaunch restarts exactly one. State is the live child handles
 * — the process table (and the blend map) is the truth, no pid files.
 */
export declare class TeamProcess {
    readonly projectRoot: string;
    private readonly spawner;
    private blendStarter?;
    private procs;
    private blends;
    constructor(projectRoot: string, spawner: SeatSpawner, blendStarter?: BlendStarter | undefined);
    /** Late-bind the blend starter (the five-dead-seats fix, 2026-08-13): the
     * registry memoizes the FIRST instance per project, and the restart
     * handoff's --boot path once created it starter-less — every later boot
     * through the cached instance then spawned runner children that S4's
     * double-consumer refusal killed on sight: five dead seats, and the Team
     * menu could not recover because it kept reaching the same cached
     * instance. Any caller that HAS a starter now upgrades the instance. */
    adoptBlendStarter(bs: BlendStarter): void;
    /** True once any seat has been booted and at least one child is alive. */
    get booted(): boolean;
    private stamp;
    private spawnSeat;
    /** THE branch point: blended vs runner child, decided fresh from rig.conf
     * every launch (a restaff or flag edit takes effect on the next relaunch).
     * Kills/stops whatever currently runs for the seat first. */
    private launchSeat;
    private seatAlive;
    /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
    boot(): TeamProcStatus;
    /** Restart exactly one seat (the Team menu's per-seat Relaunch). Re-reads
     * rig.conf, so a restaffed or re-flagged seat lands on the right path. */
    relaunch(seat: Seat): TeamProcStatus;
    /** D12 refresh, blended form: the refresh IS a visible restart of the live
     * pane. Refused mid-response (a fresh session that tore a running turn in
     * half would lose work — the impeccable-context law); force overrides.
     * Non-blended seats return handled:false — the caller falls through to the
     * headless refreshSeat path. */
    refreshBlended(seat: Seat, opts?: {
        force?: boolean;
    }): {
        handled: boolean;
        ok?: boolean;
        reason?: string;
    };
    /** Park exactly ONE seat, deliberately and visibly (the lifecycle PDR's
     * opt-in idle knob — workers only; the caller enforces never-the-
     * orchestrator). The stamp lands BEFORE the stop so the record says why;
     * the seat then reads as unstaffed (a calm invitation), never as dead. */
    parkSeat(seat: Seat, note: string): void;
    /** Stop the whole team (SIGTERM every runner; stop every blended seat).
     * CE-135 (battle test 2026-08-18): every stop() call site is DELIBERATE
     * (scoped park, operator stop, shutdown handoff) — so the seat records
     * clear, same as parkSeat: a parked workspace must read as calm
     * invitations, never as died-with-a-startedAt. A CRASHED seat keeps its
     * record (stop never ran for it) and stays the downchip's distress. */
    stop(): TeamProcStatus;
    status(): TeamProcStatus;
}
export declare function teamProcessFor(projectRoot: string, spawner: SeatSpawner, blendStarter?: BlendStarter): TeamProcess;
/** Read one team's status WITHOUT creating a supervisor (the workspace
 * rail's live-count read — a peek must never instantiate lifecycle). */
export declare function peekTeam(projectRoot: string): TeamProcStatus | undefined;
/** The idle knob's minutes from rig.conf — undefined = OFF (the default:
 * cmux never reaps your idle terminals; a team runs until Adam parks it). */
export declare function idleParkMinutes(conf: Record<string, string>): number | undefined;
/** PURE: which seats the idle knob parks right now. Workers only — NEVER
 * the orchestrator (the PDR's invariant: it holds the loop's context).
 * Guards: the knob must be set; the rig must have been quiet for the whole
 * window (newest turns.log mtime); and each candidate must have been UP at
 * least that long (a just-booted team with no turns yet gets its grace). */
export declare function idleParkTargets(st: TeamProcStatus, idleMin: number | undefined, lastActivityMs: number | null, now: number): Seat[];
/** Test/shutdown helper: drop all supervised teams (kills their seats). */
export declare function stopAllTeams(): void;
/** The /api/restart handoff (runner-deaths fix, FLAWS 2026-08-11): stop every
 * team while THIS process is still alive — so the runners die by
 * parent-delivered SIGTERM and the parent's EXIT handlers actually get to
 * write their stamps (the old restart just process.exit(0)'d, orphaning the
 * children to silent code-0 watchdog deaths with no forensic trail). Returns
 * what was running so the caller can tell the fresh server to boot it back. */
export declare function handoffStop(): {
    wasBooted: boolean;
    stopped: number;
};
