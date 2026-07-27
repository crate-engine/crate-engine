/** Product default brain origin: the private DISTRIBUTION repo (product-only
 * snapshots published by dev/dist-repo/publish.sh — testers get this; the
 * workshop repo with the internal record stays private to us). Dev setup
 * clones from the local working repo instead — gate answer Q3. */
export declare const PRODUCT_ENGINE_ORIGIN = "https://github.com/crate-engine/crate-engine.git";
export interface TierPaths {
    root: string;
    defaultsFile: string;
    overlayDir: string;
    engineDir: string;
}
export declare class UserTierError extends Error {
}
export declare function tierPaths(home: string): TierPaths;
/** Seed the verified staffing when no defaults exist yet (the installer
 * clones the engine without running setup — the app seeds on first start).
 * Detection-aware (P6-6 direction change): the engine assumes agents are
 * already installed+signed in and never installs them — so when the verified
 * Coder harness (claude) isn't ready on this machine but pi is, the seed
 * falls the Coder back to pi rather than pre-selecting a seat that can't
 * boot. The user can re-staff on the staffing screen at any time. */
export declare function seedDefaultsIfAbsent(home: string, opts?: {
    path?: string;
}): boolean;
export interface SetupReport {
    actions: string[];
}
/**
 * Create/heal the user tier. `engineSource` is a local path or git URL; the
 * dev default (the local working clone) is decided by the CLI, not here.
 */
export declare function setupTier(home: string, opts: {
    engineSource: string;
}): SetupReport;
/**
 * Run #13 (Adam): `crate open` must be PROJECT-ASSOCIATED — with several rigs
 * on one machine, "the last project" is ambiguous. The anchor is the repo
 * itself: a folder with an attached `.agents/` IS a Crate Engine project, so
 * `crate open` run inside one opens THAT project (v1 `crate up` muscle
 * memory). Returns the dir when it is an attached project, else undefined.
 */
export declare function projectAt(dir: string): string | undefined;
export declare function writeLastProject(home: string, projectRoot: string): void;
export declare function readLastProject(home: string): string | undefined;
export declare function appUrlPath(home: string): string;
export interface UpdateReport {
    before: string;
    after: string;
    fastForwarded: boolean;
    /** Overlay entries whose BASE file changed in this update — review them. */
    flagged: Array<{
        entry: string;
        note: string;
    }>;
}
/**
 * P4-6 `crate2 update`: fetch + `--ff-only` merge on the pristine clone
 * (guaranteed to fast-forward because P4-5 never edits it), then the overlay
 * compatibility pass: any overlay entry whose recorded base-file hash changed
 * is FLAGGED plainly — never auto-merged, never dropped. Records refresh after
 * flagging so only NEW base changes flag on the next update.
 */
export declare function updateEngine(home: string): UpdateReport;
