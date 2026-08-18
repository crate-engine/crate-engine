/** Workspace lifecycle (PDR dev/pdr/workspace-lifecycle.md, decision 2):
 * a workspace is Running or Parked; `desired` is the persisted RECORD of
 * which — it replaces the single global ~/.crate/last-project. Restart
 * resumes exactly what the record says (never more), and focus (`focusedAt`)
 * is a VIEW default with zero lifecycle consequence. */
export type WorkspaceDesired = "running" | "parked";
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
    /** The lifecycle RECORD: what should be running (default parked). */
    desired: WorkspaceDesired;
    /** View default: when a window last focused this workspace (ms), if ever. */
    focusedAt?: number;
}
export declare function workspacesFile(home: string): string;
/** Record the lifecycle intent — boot/staff mark running, a scoped stop
 * marks parked. This is the ONLY thing restart-resume reads. */
export declare function setWorkspaceDesired(home: string, projectPath: string, desired: WorkspaceDesired): void;
/** Record a focus (a VIEW default — used only to pick where a bare
 * `crate open` / project-less window lands; never touches lifecycle). */
export declare function setWorkspaceFocused(home: string, projectPath: string): void;
/** Every workspace the record says should be running (rig-validated). */
export declare function desiredRunning(home: string): string[];
/** The newest-focused valid rig — the view default for a bare open. */
export declare function lastFocusedWorkspace(home: string): string | undefined;
/** One-time migration: the old single global ~/.crate/last-project becomes
 * that workspace's focusedAt + desired=running (it was the auto-booted one),
 * then the file is retired. Idempotent — a missing file is a no-op. */
export declare function migrateLastProject(home: string): void;
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
