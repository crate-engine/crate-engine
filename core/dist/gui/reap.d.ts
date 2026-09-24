export interface TaggedProc {
    pid: number;
    project: string;
    cmd: string;
    /** started under `crate team` (hosted outside the app) — the sweep never claims it */
    selfHosted?: boolean;
}
/** Canonical project path for comparisons (symlinks, /private/var on macOS). */
export declare function canonProject(p: string): string;
/** The value of CRATE_PROJECT inside a macOS `ps -E` line (command + env,
 * space-separated): up to the next ` KEY=` token, so a path with spaces holds. */
export declare function tagFromPsLine(line: string): string | undefined;
/** Every live process on this host that carries a CRATE_PROJECT tag. */
export declare function listTagged(): TaggedProc[];
/** This process and every ancestor — never signalled. */
export declare function selfAndAncestors(): Set<number>;
/** SIGTERM, wait up to graceMs, SIGKILL the holdouts. Returns pids still alive. */
export declare function terminate(pids: number[], graceMs?: number): Promise<number[]>;
/** Tagged processes belonging to one project (canonical match). */
export declare function taggedFor(project: string, all?: TaggedProc[]): TaggedProc[];
export interface TeardownReport {
    /** processes closed by the tag sweep (the team's own supervisor already stopped its seats) */
    closed: number;
    /** tagged processes still alive after SIGKILL — the honest "0" check */
    remaining: number;
    /** what `dev-server down` said (undefined when the rig has no dev-server tool) */
    devServer?: string;
}
/**
 * After the team is stopped: take the workspace's dev server down (any backend —
 * `dev-server down` also handles a supervised launchd/systemd unit, which
 * carries no tag) and terminate every process still tagged to it. Returns the
 * count left — Stop's proof.
 */
export declare function teardownWorkspace(project: string, opts?: {
    graceMs?: number;
    skipDevServer?: boolean;
}): Promise<TeardownReport>;
/**
 * The sweep: close processes tagged to workspaces this engine has on record as
 * NOT running. `stopped` is the canonical-path set of those workspaces
 * (desired=parked, archived, …) — built by the caller from THIS engine's record.
 */
export declare function sweepStopped(stopped: Set<string>, graceMs?: number): Promise<{
    project: string;
    closed: number;
}[]>;
