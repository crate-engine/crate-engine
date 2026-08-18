import { type Server } from "node:http";
import { type ReviveNote } from "../health.js";
export interface GuiState {
    home: string;
    /** The project the health/boot screens operate on (set by attach, or --project). */
    project?: string;
    /** P7-T5 auto-revive notes (newest last; ring-capped) — shown on the health page. */
    reviveNotes?: ReviveNote[];
    /** T7-3: the dist cli.js this server runs from — used to spawn seat runners. */
    cliPath: string;
    /** Preview proxies (satellites + Launch in Chrome, 2026-08-13; PER
     * WORKSPACE since the lifecycle PDR — singletons followed the last-
     * attached project and lied to everyone else): target origins and proxy
     * ports keyed by project root, pointed by the tokened cockpit call. */
    previewTargets: Map<string, string>;
    previewProxyPorts: Map<string, number>;
    /** Pack 3 (stale-reattach): the engine sha THIS process loaded at boot.
     * /api/version reports it so a reattaching `crate open` can tell a stale
     * survivor from a fresh server — engineVersion()'s own sha is DISK truth
     * at request time, which on a stale server reports the NEW sha and hides
     * exactly the mismatch that matters (live-found 2026-08-12). */
    loadedSha?: string;
}
/** The engine sha on DISK right now (~/.crate/engine HEAD; dev fallback =
 * this source tree). At server BOOT this is the loaded code's sha (the
 * process was just spawned from that disk); `crate open` calls it later to
 * know what a FRESH server would load. "unknown" on any failure. */
export declare function diskEngineSha(home: string): string;
/** Pack 3 (stale-reattach): a reattaching `crate open` keeps the running
 * server ONLY when it provably runs the disk engine. Order matters:
 * an unjudgeable DISK (no git — tarball install) keeps the server (never
 * restart-thrash what we cannot compare), while a server that cannot name
 * its loaded sha (pre-Pack-3 survivor) restarts once onto code that can —
 * a restart costs seconds; a silent stale server broke the update promise
 * (live-found 2026-08-12). */
export declare function serverIsStale(loadedSha: string | undefined, diskSha: string): boolean;
export declare function engineVersion(home: string): {
    version: string;
    updateAvailable: boolean;
};
/** The fresh server's argv for POST /api/restart (runner-deaths fix, FLAWS
 * 2026-08-11). --boot rides along IFF the team was running when restart was
 * pressed — so the relaunched cockpit comes back over a LIVE rig instead of
 * five booted:false seats, while a plain `crate gui` (no flag) never
 * auto-boots anything. Exported pure so the iff is unit-provable. */
export declare function restartArgv(state: Pick<GuiState, "cliPath" | "project">, urlFile: string): string[];
export interface GuiServer {
    server: Server;
    port: number;
    token: string;
    url: string;
    state: GuiState;
    /** The focused workspace's preview-proxy port (back-compat single form). */
    previewProxyPort?: number;
    /** EVERY workspace's preview-proxy port — the &pv= handshake list, so the
     * remote tunnel forwards each workspace's previews (lifecycle PDR d.7). */
    previewProxyPorts: number[];
}
export declare function pickerRoots(state: Pick<GuiState, "home" | "project">): Promise<string[]>;
/** CE-014 P0 — DETACHED IS NOT CRASHED.
 *
 * One engine per host, so a viewer can ask about a workspace this engine is NOT
 * bound to. Its seats are genuinely not running, but the honest reason is "the
 * engine is serving a different workspace", not "your team died". The system
 * knew this all along (last-project, gui.log) and did not say it: on 2026-08-16
 * the cockpit rendered five empty "staff this seat" panes, visually identical to
 * a crash, and cost the operator a morning of misdiagnosis.
 *
 * Pure on purpose — the endpoint is a one-liner over this, and the WORDING is
 * the whole fix, so it is worth pinning directly. */
export declare function startGuiServer(opts?: {
    home?: string;
    project?: string;
    detectPath?: string;
    cliPath?: string;
    /** Test seam: replaces the real runner spawner (a boot in a hermetic
     * test must never spawn `node <test-file> runner …`). */
    seatSpawner?: import("./teamproc.js").SeatSpawner;
}): Promise<GuiServer>;
