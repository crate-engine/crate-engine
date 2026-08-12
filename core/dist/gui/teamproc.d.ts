import { type ChildProcess } from "node:child_process";
import { type Seat } from "../manifest.js";
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
export declare function defaultSeatSpawner(cliPath: string, home?: string): SeatSpawner;
export interface TeamProcStatus {
    booted: boolean;
    seats: Array<{
        seat: Seat;
        alive: boolean;
        pid: number | null;
        startedAt: number | null;
    }>;
}
/**
 * Supervises one headless team (per project root). Boot spawns a runner child
 * per seat; stop kills them; relaunch restarts exactly one. State is the live
 * child handles — the process table is the truth, no pid files.
 */
export declare class TeamProcess {
    readonly projectRoot: string;
    private readonly spawner;
    private procs;
    constructor(projectRoot: string, spawner: SeatSpawner);
    /** True once any seat has been booted and at least one child is alive. */
    get booted(): boolean;
    private spawnSeat;
    /** Boot every not-already-running seat. Idempotent: a live seat is left alone. */
    boot(): TeamProcStatus;
    /** Restart exactly one seat's runner (the Team menu's per-seat Relaunch). */
    relaunch(seat: Seat): TeamProcStatus;
    /** Stop the whole team (SIGTERM every seat). */
    stop(): TeamProcStatus;
    status(): TeamProcStatus;
}
export declare function teamProcessFor(projectRoot: string, spawner: SeatSpawner): TeamProcess;
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
