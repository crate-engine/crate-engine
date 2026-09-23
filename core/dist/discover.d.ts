/** ready = a Crate project wired to THIS engine; heal = wired to an older/moved
 * engine, or missing state files this engine expects (attach repairs both);
 * new = a repo Crate has not met yet. */
export type ProjectState = "ready" | "heal" | "new";
export interface DiscoveredProject {
    name: string;
    path: string;
    state: ProjectState;
    /** ms since epoch when the operator last focused it (registered projects only) */
    lastOpened?: number;
}
export declare function projectState(dir: string, engineDir: string): ProjectState;
/**
 * The list a person picks from: registered (recent) projects first, newest
 * focus first; then every project folder one level under each root, A–Z.
 * Hidden folders, files and non-projects are skipped. `max` bounds the scan.
 */
export declare function discoverProjects(opts: {
    roots: string[];
    recents: Array<{
        path: string;
        focusedAt?: number;
    }>;
    engineDir: string;
    max?: number;
}): DiscoveredProject[];
export interface SshHostEntry {
    name: string;
    hostName?: string;
}
/** `Host` names from an ssh config (wildcards and negations skipped), each
 * with its HostName when the block declares one. */
export declare function parseSshHosts(text: string): SshHostEntry[];
export interface SshComputer {
    /** the name to type/click — the FIRST alias declared for that machine */
    name: string;
    aliases: string[];
    hostName?: string;
}
/** Fold aliases that resolve to the same HostName into ONE computer (superman
 * / superman-wifi / superman-ts are one box, not three strangers). Entries
 * without a HostName stand alone. Declaration order is kept. */
export declare function foldSshHosts(entries: SshHostEntry[]): SshComputer[];
