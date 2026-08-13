export interface ServerRow {
    port: number;
    pid: number;
    label: string;
    /** seat that registered it, or "discovered" */
    from: string;
    /** the loop (branch) it belongs to; "" when unknown */
    task: string;
    kind: "registered" | "discovered" | "system-service";
    status: "live" | "orphaned";
    orphanedAt: string | null;
    /** last preview registration touch (the registry upserts per registration) */
    registeredAt: string | null;
    killable: boolean;
    rssMb: number | null;
    ageSecs: number | null;
}
export interface KillResult {
    ok: boolean;
    freed: boolean;
    escalated: boolean;
    port: number;
    pid: number;
    note: string;
}
export type Exec = (cmd: string, args: string[]) => string;
export declare function hasLsof(): boolean;
interface Listener {
    pid: number;
    port: number;
}
/** Every TCP listener on the machine, as (pid, port) pairs — read-only. */
export declare function listListeners(exec?: Exec): Listener[];
/** ps etime is [[dd-]hh:]mm:ss. */
export declare function parseEtime(s: string): number | null;
export interface ServersView {
    servers: ServerRow[];
    /** killable orphans only — the chip count; an unkillable "orphan" is a
     * system service and never needs the operator's attention */
    orphans: number;
    lsofAvailable: boolean;
}
export declare function serversView(proj: string, exec?: Exec): ServersView;
/** The confirmed-kill doctrine (precheck Rider 1): SIGTERM the GROUP, PROVE
 * the port freed by binding it, escalate to SIGKILL once, stamp honestly.
 * Refuses stale rows (the pid must still hold the port RIGHT NOW — pid reuse
 * between panel paint and click must not kill an innocent). */
export declare function confirmedKill(port: number, pid: number, exec?: Exec): Promise<KillResult>;
/** One click, still the operator's: kill every killable orphan, sequentially,
 * each through the same confirmed-kill. Freed ports prune on the next read. */
export declare function sweepOrphans(proj: string, exec?: Exec): Promise<KillResult[]>;
export {};
