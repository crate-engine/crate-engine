export interface LoopNarration {
    /** Human line for the masthead chip, e.g. "round 2 — review & QA are checking". */
    text: string;
    /** The folded loop state the text was derived from. */
    state: string;
    /** Timestamp of the event that set the state (agentctl local-time ISO). */
    at: string | null;
}
/** Narrate the CURRENT run: everything after the last START_IMPL (a new work
 * order resets the round count). Returns null when there is nothing to say
 * (no events yet) — the chip hides rather than invent a state. */
export declare function loopNarration(lines: string[]): LoopNarration | null;
