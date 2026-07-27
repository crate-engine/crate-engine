/** The freshness law: a refresh is safe iff the seat is NOT mid-turn AND its
 * state file was written at/after the latest turn's START (so the state
 * reflects that turn's work). No turns yet = fresh (nothing to lose). */
export declare function stateIsFresh(projectRoot: string, seat: string): boolean;
export interface RefreshResult {
    ok: boolean;
    reason?: string;
}
/** Drop a seat's session so its next turn starts fresh. Refused on stale
 * state unless force=true. */
export declare function refreshSeat(projectRoot: string, seat: string, opts?: {
    force?: boolean;
}): RefreshResult;
