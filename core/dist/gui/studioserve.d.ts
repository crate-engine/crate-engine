export declare const VIEWER_TTL_MS = 12000;
export declare const PROXY_TTL_MS = 30000;
export declare const GRACE_MS = 120000;
export interface StudioPlan {
    port: number;
    bind: string;
    /** node + static-serve.js + args */
    argv: string[];
}
export interface StudioStatus {
    managed: true;
    running: boolean;
    port: number;
    /** Studio windows checking in right now */
    windows: number;
    designer: boolean;
    /** ms until it stops (only when running and nobody is using it) */
    stopsInMs?: number;
    /** why it could not start (e.g. the port is held by someone else) */
    blocked?: string;
}
/** How this project would be previewed by the engine — undefined when the
 * project has a real dev command (its dev server is the preview) or nothing
 * static to serve. Reads the ONE serve resolution (bin/serve-resolve). */
export declare function studioPlan(projectRoot: string, engineBin: string): StudioPlan | undefined;
export declare function demandPath(projectRoot: string): string;
/** One per engine: the on-demand Studio preview servers of every workspace. */
export declare class StudioServers {
    private readonly engineBin;
    private readonly log;
    private readonly now;
    private entries;
    private plans;
    constructor(engineBin: string, log?: (line: string) => void, now?: () => number);
    /** Cached plan (serve-resolve runs once per project per engine start). */
    plan(projectRoot: string): StudioPlan | undefined;
    private entry;
    /** A Studio window checked in. Returns true when this project is engine-served. */
    touchViewer(projectRoot: string, viewer: string): boolean;
    /** Traffic through the workspace's preview proxy. */
    touchProxy(projectRoot: string): void;
    private users;
    /** Start/stop to match demand. `running` = the workspaces allowed to serve at all. */
    tick(running: Set<string>): Promise<void>;
    private start;
    private stop;
    /** Stop everything (engine shutdown). */
    stopAll(): void;
    /** What the Dev Servers panel and the Studio show. */
    status(projectRoot: string): StudioStatus | undefined;
}
