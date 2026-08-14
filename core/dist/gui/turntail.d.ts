import { type StreamEvent } from "./teamview.js";
export interface TailEvent extends StreamEvent {
    seat: string;
}
type Listener = (ev: TailEvent) => void;
export declare class TurnTailHub {
    private projectRoot;
    private pollMs;
    private seats;
    private watchers;
    private listeners;
    private timer?;
    private scanQueued;
    private pokeQueued;
    constructor(projectRoot: string, pollMs?: number);
    /** Subscribe a listener; the first subscriber starts the watchers, the
     * last one's unsubscribe stops them (no idle handles for closed pages). */
    subscribe(fn: Listener): () => void;
    /** The connect-time replay: the last `maxTurns` turns per seat as seam +
     * policy-filtered events, straight from the files (stateless — a client
     * REPLACES its feed with this, so reconnects can never duplicate). */
    backlog(maxTurns?: number, maxPerSeat?: number): TailEvent[];
    private start;
    /** Coalesce state-watcher bursts into ONE poke (a close writes several
     * files; the client needs one refresh, not five). */
    private queuePoke;
    private stop;
    /** Coalesce watcher bursts (the runner appends one line per fs event). */
    private queueScan;
    private scan;
    private drain;
    private broadcast;
}
export declare function hubFor(projectRoot: string, pollMs?: number): TurnTailHub;
/** Test/shutdown hook: drop every hub (watchers close via refcount 0). */
export declare function resetHubs(): void;
export {};
