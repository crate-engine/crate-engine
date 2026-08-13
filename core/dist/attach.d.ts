export declare class AttachError extends Error {
}
export interface ResolvedTarget {
    projectRoot: string;
    project: string;
    /** true when the directory already exists on disk. */
    exists: boolean;
}
/**
 * Resolve the target argument: "." / a path (abs, rel, ~/) → that directory;
 * a bare NAME → $PROJECTS_ROOT/<name> (default ~/Projects — local-first).
 */
export declare function resolveTarget(arg: string | undefined, opts?: {
    cwd?: string;
    projectsRoot?: string;
    home?: string;
}): ResolvedTarget;
export interface DirEntry {
    name: string;
    /** Has a .git — shown as a badge so repos are easy to spot. */
    isRepo: boolean;
}
export interface DirListing {
    path: string;
    /** Absent at the jail root (the user's home). */
    parent?: string;
    dirs: DirEntry[];
}
/**
 * List the sub-FOLDERS of a path for the attach screen's picker. Jailed to
 * the user's home (the app browses projects, not the system); hidden folders
 * are skipped; a missing/blank path falls back to home.
 */
export declare function listDirs(rawPath: string | undefined, opts?: {
    home?: string;
}): DirListing;
/**
 * Create ONE new folder inside a picker path (run #6 finding: making a folder
 * shouldn't require leaving the app for Finder). Same home jail as listDirs;
 * the name must be a single plain component; an existing folder refuses.
 * Returns the created folder's listing so the picker can step into it.
 */
export declare function makeDir(rawParent: string | undefined, name: string, opts?: {
    home?: string;
}): DirListing;
export type WriteKind = "committed" | "local";
export type WriteAction = "create" | "heal" | "keep";
export interface PlannedWrite {
    /** Path relative to the project root (as the disclosure shows it). */
    rel: string;
    /** committed = lives in your repo; local = never pushed (.agents wiring/state). */
    kind: WriteKind;
    action: WriteAction;
    note: string;
}
export interface AttachPlan {
    projectRoot: string;
    project: string;
    engineDir: string;
    mode: "attach" | "create";
    /** Project dir missing → created (create mode only). */
    createsProjectDir: boolean;
    /** Project is not a git repo (attach mode): needs a decision. */
    needsGit: boolean;
    writes: PlannedWrite[];
}
/**
 * The dev port for the rig.conf seed — read from the project's own scripts
 * instead of a blind 3000 (the P7-T1 find: a :5188 static site got a :3000
 * DEV_URL, so QA/preview would aim at a dead port). Explicit port flags win;
 * then well-known tool defaults; else 3000. Best-effort — a wrong guess is
 * still a one-line rig.conf edit, and doctor/dev-server report the drift.
 */
export declare function detectDevPort(projectRoot: string): number;
/**
 * Plan an attach/create against a target. Throws AttachError (plainly) on the
 * junk-path cases; never writes anything.
 */
export declare function planAttach(target: ResolvedTarget, engineDir: string, opts?: {
    create?: boolean;
}): AttachPlan;
export interface AttachReport {
    /** rel paths actually created or modified (the disclosure-truth check). */
    changed: string[];
    gitInitialized: boolean;
    firstCommit?: string;
    /** Absolute path of the local origin mirror, when one was set up (PHASE-B #3). */
    originMirror?: string;
    /** GitHub repo URL when the optional create+push step ran (create mode). */
    githubRepo?: string;
    /** Why the GitHub step was skipped/failed — the attach itself succeeded. */
    githubNote?: string;
}
/** Rewrite the managed .gitignore block: strip any old block, append the fresh one. */
export declare function writeManagedGitignore(file: string): void;
export declare function executeAttach(plan: AttachPlan, opts?: {
    gitInit?: boolean;
    githubRepo?: boolean;
}): AttachReport;
/**
 * Flaw 1 (Adam's battle test, 2026-08-10): an attached repo can carry a
 * rig.conf from another life — its DEV_URL aimed at a server some OTHER rig
 * runs (live case: jdm-rush-crate inherited the LIVE site's dev server; the
 * doctor green-lit it and runtime QA would have tested the wrong code).
 * Attach heals: a non-loopback host, or a loopback port something else
 * already owns, is rewritten to a FREE loopback port — and says so.
 * Probe/picker injectable for tests.
 */
export declare function healDevUrl(projectRoot: string, opts?: {
    /** true = something is listening on 127.0.0.1:<port>. */
    probeBusy?: (port: number) => Promise<boolean>;
    /** first candidate for the replacement port scan. */
    scanFrom?: number;
}): Promise<string | undefined>;
