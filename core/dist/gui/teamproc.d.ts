import { type ChildProcess } from "node:child_process";
import { type Seat } from "../manifest.js";
export interface SeatProc {
    seat: Seat;
    child: ChildProcess;
    startedAt: number;
}
/** A launcher for one seat's runner — injectable so tests use a stub. */
export type SeatSpawner = (seat: Seat, projectRoot: string) => ChildProcess;
/** The default spawner: `node <cli.js> runner <seat> --project <root>`. */
export declare function defaultSeatSpawner(cliPath: string): SeatSpawner;
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
