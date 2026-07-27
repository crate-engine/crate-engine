export interface Workspace {
    /** Display name (the repo's basename; disambiguated on collision). */
    name: string;
    /** Absolute project root. */
    path: string;
    /** The path still exists on disk. */
    exists: boolean;
    /** It is a crate rig (has .agents/rig.conf) — a stale/moved entry is not. */
    rig: boolean;
    /** Newest turn-log mtime across seats (ms), or null if the team never ran. */
    lastActivityMs: number | null;
}
export declare function workspacesFile(home: string): string;
/** The registered workspaces, enriched with disk state (newest activity first). */
export declare function listWorkspaces(home: string): Workspace[];
/**
 * Register a project path (idempotent — dedup by absolute path). Returns the
 * updated list. Names collide-disambiguate by appending the parent dir, so two
 * different repos both named "app" stay distinguishable in the rail.
 */
export declare function registerWorkspace(home: string, projectPath: string): Workspace[];
/** Drop a workspace from the rail (does NOT touch the repo on disk). */
export declare function removeWorkspace(home: string, projectPath: string): Workspace[];
