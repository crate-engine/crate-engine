import { type BlendCli, type StaleTracker } from "./blend.js";
import { type Seat } from "./manifest.js";
import { type StartTtyOpts, type StartTtyResult } from "./ptyseat.js";
/** What teamproc (and the cockpit behind it) needs from a blended seat —
 * deliberately narrow so tests drive TeamProcess with a stub. */
export interface BlendedSeatHandle {
    readonly startedAt: number;
    /** The standing delivery loop is up (the pane itself may be between
     * respawns — the next delivery revives it; the SEAT is still alive). */
    alive(): boolean;
    /** Provider evidence says unfinished or unknown; automatic reset must wait. */
    responding(): boolean;
    stop(): void;
}
export interface BlendedSeatOpts {
    projectRoot: string;
    seat: Seat;
    /** Staffed agent string from rig.conf (any alias). */
    agentArg: string;
    cli: BlendCli;
    model?: string;
    home: string;
    /** Shared per-project tracker (the task-end watcher marks it). */
    stale: StaleTracker;
    /** D12 auto-mode (rig.conf CONTEXT_AUTO_REFRESH — the same knob as
     * headless): over the ceiling → sessionFile dropped by the inherited loop
     * hook → the next delivery respawns the pane fresh, VISIBLY. */
    contextAutoRefresh?: boolean;
    /** Tests: replace the real PTY spawn. */
    startTty?: (o: StartTtyOpts) => Promise<StartTtyResult>;
    sleep?: (ms: number) => Promise<void>;
    spawnSettleMs?: number;
    busyPollMs?: number;
    pollMs?: number;
}
export declare class BlendedSeat implements BlendedSeatHandle {
    private readonly o;
    readonly startedAt: number;
    private tty?;
    /** PINNED session — set only after a delivery marker proved which
     * candidate file is ours (all-seats coherence: several blended seats
     * share one cwd, so "the newest file" can be another seat's session). */
    private session?;
    private spawnMs;
    /** The last spawn resumed a persisted session (sessionFile existed) — an
     * unpinned-but-resumed session is already oriented; a fresh one is not. */
    private lastSpawnResumed;
    /** Arms blendedTurn's external-drop lever (verify-dispatch fresh-eyes /
     * D12 refreshSeat rm turns/<seat>/session.json). */
    private readonly persistRef;
    private readonly ac;
    private loopLive;
    private stopped;
    constructor(o: BlendedSeatOpts);
    /** Fire the standing loop (a floating promise — the supervisor's lifetime
     * IS the loop's; stop() aborts it). Never throws: a dying loop stamps
     * honestly and reads as not-alive, so relaunch can act. */
    start(): void;
    alive(): boolean;
    responding(): boolean;
    stop(): void;
    private stamp;
    private run;
    private runOwned;
    /** The ONE respawn seam (boot aside): serves crash recovery, the fresh-
     * per-task reset, and the D12 refresh path (which drops sessionFile before
     * relaunching). Fresh-vs-resume is decided by the stale tracker: a seat at
     * a task boundary gets clean eyes (sessionFile dropped → no --resume); an
     * unexpectedly dead pane resumes where it was. */
    private respawn;
    /** Two doors, never two writers: the old PTY must be provably gone before
     * a new one opens on the same seat. */
    private killAndAwaitExit;
    private spawnPty;
    /** Every session file this spawn COULD be (all-seats coherence: seats
     * share one cwd, so the dir holds several seats' sessions — a candidate
     * list, never a pick-and-trust). */
    private candidates;
    /** The pinned session when proven, else the newest candidate (best-effort
     * for responding/gauges; the sessionFile persist only ever uses PINNED
     * truth — blendedTurn calls onVerified → pinByMarker first). */
    private locateSession;
    /** Delivery-verification text: the pinned file alone once proven; before
     * that, EVERY candidate concatenated — the marker can only ever land in
     * our own session, so verification over the union is exact while the
     * other seats' files are mere inert noise. */
    private readSession;
    /** Self-verifying discovery: the delivery marker names OUR file — pin it.
     * Called by blendedTurn after on-disk verification, before the
     * sessionFile persist (so gauges/crash-resume only ever see proven ids). */
    private pinByMarker;
    /** Fresh session (unpinned, not a resume) = first delivery carries the
     * visible re-orientation; pinned or resumed = already oriented. */
    private needsOrientation;
}
interface BlendCrew {
    stale: StaleTracker;
}
/** Durable per-seat reset generations. The event ledger is checked at delivery
 * time, so CLOSE followed immediately by an engine restart cannot lose intent.
 * Persistence overrides are read fresh; the orchestrator keeps its context. */
export declare function blendCrewFor(projectRoot: string): BlendCrew;
/** Test seam: drop the in-memory crew cache; durable generations remain. */
export declare function resetBlendCrews(): void;
/**
 * The real starter teamproc uses for a flagged, eligible seat: staffing through
 * the CANONICAL chain (rig.conf → ~/.crate/defaults.yaml → loadout floor), the
 * project's shared stale tracker, the standing loop fired.
 *
 * CE-141: this read rig.conf alone and fell back to bare pi, so a freshly
 * attached rig ran pi on the account default while every display showed the
 * user's configured seat. resolveSeatStaffing is the one door now.
 */
export declare function defaultBlendStarter(home: string): (seat: Seat, projectRoot: string) => BlendedSeatHandle;
export {};
