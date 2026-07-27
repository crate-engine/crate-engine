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
