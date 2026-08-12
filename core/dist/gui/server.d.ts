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
}
export declare function engineVersion(home: string): {
    version: string;
    updateAvailable: boolean;
};
/** The fresh server's argv for POST /api/restart (runner-deaths fix, FLAWS
 * 2026-08-11). --boot rides along IFF the team was running when restart was
 * pressed — so the relaunched cockpit comes back over a LIVE rig instead of
 * five booted:false seats, while a plain `crate gui` (no flag) never
 * auto-boots anything. Exported pure so the iff is unit-provable. */
export declare function restartArgv(state: Pick<GuiState, "cliPath" | "project">, urlFile: string, wasBooted: boolean): string[];
export interface GuiServer {
    server: Server;
    port: number;
    token: string;
    url: string;
    state: GuiState;
}
export declare function startGuiServer(opts?: {
    home?: string;
    project?: string;
    detectPath?: string;
    cliPath?: string;
}): Promise<GuiServer>;
