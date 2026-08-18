export type FleetHostState = "connected" | "connecting" | "asleep" | "failed" | "unknown";
export interface FleetWorkspaceRow {
    name: string;
    path: string;
    /** The lifecycle record + live count — absent on a pre-lifecycle remote
     * engine (honest degrade: name-only rows, the skew marker says why). */
    desired?: "running" | "parked";
    liveSeats?: number;
    /** The cockpit URL the window loads to view this workspace. */
    url: string;
}
export interface FleetHostRow {
    host: string;
    local: boolean;
    state: FleetHostState;
    /** Plain words for asleep/failed (superman's 22:30 nap is a state, not an error). */
    note?: string;
    engineSha?: string;
    /** True when this host's engine sha differs from the hub's (decision 5:
     * shown honestly, never auto-fixed — the UPDATE menu fans out). */
    skew: boolean;
    workspaces: FleetWorkspaceRow[];
    /** CE-136: the host's cockpit door — the "＋ new rig on this host" row
     * loads this + &card=1 (the summonable card), so an EMPTY host is never
     * a dead-end in the Fleet menu. Present when the host is reachable. */
    cockpitUrl?: string;
}
export interface FleetView {
    hubSha: string;
    hosts: FleetHostRow[];
}
/** Injectable side effects — hermetic tests drive the whole brain. */
export interface FleetExec {
    /** ssh runs (app-url read, remote boot). */
    run(cmd: string, args: string[], timeoutMs: number): Promise<{
        stdout: string;
        stderr: string;
    }>;
    /** Spawn an OWNED tunnel child (never detached). */
    spawnTunnel(args: string[]): {
        kill(): void;
        alive(): boolean;
    };
    /** Tokened JSON reads through the tunnel. */
    fetchJson(url: string, timeoutMs: number): Promise<unknown>;
    /** Liveness probe through the tunnel (any HTTP answer = alive). */
    probeHttp(url: string, timeoutMs: number): Promise<boolean>;
}
export declare function defaultFleetExec(): FleetExec;
interface HostLink {
    host: string;
    state: FleetHostState;
    note?: string;
    app?: {
        port: string;
        token: string;
    };
    tunnel?: {
        kill(): void;
        alive(): boolean;
    };
    engineSha?: string;
    /** last successful workspace read (cache — the menu renders this while a
     * background refresh runs; an asleep host shows its last-known rows). */
    workspaces?: FleetWorkspaceRow[];
    fetchedAt?: number;
    dialing?: Promise<void>;
}
/** Tests only: drop all links (kills owned tunnels). */
export declare function clearFleetLinks(): void;
/** Dial one host: read its app-url over ssh (booting the engine there if
 * absent), stand up the OWNED tunnel, probe it. Coalesced — concurrent
 * callers share one dial. Never throws; failure lands in the link state. */
export declare function ensureLink(host: string, exec?: FleetExec): Promise<HostLink>;
export interface FleetLocalDeps {
    home: string;
    hubSha: string;
    /** The hub's own tokened origin (e.g. http://127.0.0.1:PORT) + token. */
    hubOrigin: string;
    hubToken: string;
    hostLabel: string;
    /** The hub's workspace rows (the server passes its own /api/workspaces truth). */
    localWorkspaces: Array<{
        name: string;
        path: string;
        desired: "running" | "parked";
        liveSeats: number;
    }>;
}
/**
 * The whole fleet, cache-first: the local row is always fresh; remote rows
 * render last-known state while unknown hosts get a BACKGROUND dial kicked
 * (fire-and-forget) so the next open is populated. This function itself
 * never dials and never blocks on ssh — the menu must open instantly.
 */
export declare function fleetView(deps: FleetLocalDeps, exec?: FleetExec): FleetView;
export interface FleetUpdateResult {
    host: string;
    local: boolean;
    ok: boolean;
    /** Plain words: "engine X → Y" / "already current" / the failure. */
    note: string;
}
/** ONE update for the whole fleet (Adam's ask, 2026-08-18: "build
 * crate-update into the app itself"): the hub updates its own engine, then
 * every remembered host over the operator's ssh — the by-hand both-machines
 * ritual becomes one app-menu click. Sequential on purpose (update output
 * stays legible per host); failures are per-host and never stop the rest.
 * Running engines stay on their loaded code until relaunch — the Fleet
 * menu's skew markers show exactly who is behind, which is the honest
 * "restart to finish" signal. */
export declare function updateFleet(home: string, localUpdate: () => {
    before: string;
    after: string;
}, exec?: FleetExec): Promise<FleetUpdateResult[]>;
/** ssh leg for a remote update (BatchMode, same posture as boot/appUrl). */
export declare function updateArgv(host: string): string[];
/** The explicit connect (POST /api/fleet/connect and the menu's Retry):
 * dial NOW, refresh rows, answer with the row. */
export declare function connectHost(host: string, deps: Pick<FleetLocalDeps, "hubSha" | "home">, exec?: FleetExec): Promise<FleetHostRow>;
export {};
