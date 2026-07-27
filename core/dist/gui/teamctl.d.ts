/** 2d durable echo/ack (grilled 2026-07-25): append one line to a role's
 * inbox audit mirror WITHOUT waking any runner — the mirror is what the
 * chat thread renders, so a write here is durably in the thread. Newlines
 * are escaped so the line-oriented parser can never truncate a message.
 * agentctl's `[iso] (sender) text` format, verbatim. */
export declare function mirrorNote(projectRoot: string, role: string, sender: string, text: string): void;
/** TS port of agentctl's operator_released(): True iff THIS task's gate is
 * armed (approved) and an operator GATE_RELEASE arrived after the arming,
 * unconsumed by a later deployed/reopen. Used by releaseGate to ABSORB a
 * repeat "merge go" instead of queueing a duplicate [MERGE] order. */
export declare function gateAlreadyReleased(projectRoot: string, task: string): boolean;
export interface GateCard {
    task: string;
    branch: string;
    deploysTo: string;
    reviewOk: boolean;
    qaOk: boolean;
}
/** W4 finding #3 (2026-07-13, live): the tester wrote `status:
 * partial-verification` + "Verified the main page…" — the old prose regex
 * read "verified" as qa-green, the operator released, and the orchestrator
 * (reading the nuance) REOPENED. The panel and the orchestrator must read one
 * truth: green requires a CLEAN pass signal in the CURRENT status (never the
 * history log), and any partial/fail/bug marker vetoes. */
export declare function qaGreen(qa: string): boolean;
/** Tasks currently at `approved` = pending merge gates awaiting "merge go". */
export declare function pendingGates(projectRoot: string): GateCard[];
/** The operator releases a gate by typing the phrase. Validates here AND lets
 * agentctl enforce it (defense in depth); returns the emit's output. */
export declare function releaseGate(projectRoot: string, task: string, phrase: string): {
    ok: boolean;
    out: string;
    absorbed?: boolean;
};
export interface ChatMessage {
    /** engine = the mechanical third voice (2d): acks written by code, never
     * attributed to the orchestrator — physics is not conversation. */
    from: "operator" | "orchestrator" | "engine";
    at: string;
    text: string;
}
/** The one-to-one thread: operator→orchestrator (the inbox audit mirror) +
 * orchestrator/engine→operator (the operator mailbox), merged in time
 * order. The chat IS the conversation, rendered from real artifacts. */
export declare function chatHistory(projectRoot: string, limit?: number): ChatMessage[];
export interface Preview {
    url: string;
    route: string;
    label: string;
    from: string;
    at: string;
}
/** PHASE-8 T5: pending previews (pages flagged for the human's eyes). */
export declare function pendingPreviews(projectRoot: string): Preview[];
/** The human's verdict on a preview: clear it, and (if changes) tell the
 * orchestrator. approve=true is the design-lock confirm. */
export declare function resolvePreview(projectRoot: string, approve: boolean, note?: string): {
    ok: boolean;
};
/** Operator sends a message to the orchestrator (deliver → its mailbox). */
export declare function sendToOrchestrator(projectRoot: string, text: string): {
    ok: boolean;
    out: string;
};
