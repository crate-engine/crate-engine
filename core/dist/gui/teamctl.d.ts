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
    /** Pack 4 (cockpit truth): released-but-unconsumed, from the EVENT record
     * (gateAlreadyReleased) — every surface renders release state from the log,
     * so a release honored elsewhere (pane phrase, another window, the CLI)
     * shows everywhere, not just in the releasing client's memory. */
    released: boolean;
}
/** TS twin of agentctl's join_verdicts() — Pack 4 (cockpit truth): the gate
 * lights read the SAME record the JOIN itself trusts. Verifier verdicts
 * recorded in events.log since this task's most recent CODE_READY (a fresh
 * sha voids all verdicts — the same freshness law as the pin); task
 * filtering mirrors gateAlreadyReleased. This REPLACED the prose regexes
 * over seat state files (verdicts()/qaGreen — deleted 2026-08-12): the
 * blended-era tester report format didn't match them, so QA showed "·" on
 * the gate card while QA had APPROVED on the record (ticket-#4), and before
 * that a partial-verification note read as green (W4 #3). Events, not prose. */
export declare function joinVerdicts(projectRoot: string, task: string): {
    reviewer?: string;
    tester?: string;
};
/** Tasks currently at `approved` = pending merge gates awaiting "merge go".
 * Lights are PER TASK from the event record (joinVerdicts) — green iff that
 * verifier's recorded result since the last code_ready is `approve`. */
export declare function pendingGates(projectRoot: string): GateCard[];
/** Pack 4 (cockpit truth): the pane-phrase fold. The operator's habit is
 * typing "merge go" INTO the orchestrator pane (both ticket-#4 gates) —
 * habit beats the surface, so the engine watches the ONE human chokepoint
 * (cockpit keyboard → POST /api/tty/input) and folds the typed bytes into
 * completed lines. CSI sequences are stripped (arrows are not typing),
 * Esc/Ctrl+C clear the draft, backspace pops, CR completes a line. The
 * buffer is capped — the phrase is short, and this is a phrase watcher,
 * never a keylogger. */
export declare function foldHumanLines(buf: string, data: Buffer): {
    buf: string;
    lines: string[];
};
/** Honor a pane-typed release: a completed line that IS the exact phrase,
 * while a gate is armed, releases through the SAME releaseGate the bar and
 * chat use (validation, durable echo, absorb-on-repeat included). The
 * keystrokes came through the cockpit's tokened human door — the OPERATOR's
 * keyboard — so the authority is the gate bar's, and the seat the pane
 * hosts never touches the emit. No gate armed / wrong phrase = nothing. */
export declare function honorPaneRelease(projectRoot: string, lines: string[]): {
    released?: string;
};
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
/** Design Studio slot state (backlog 10, PDR dev/pdr/design-studio.md) —
 * DERIVED, never reported: the slot is occupied iff a registered preview
 * exists (preview.json is written/cleared by agentctl on the design task's
 * own transitions — ticket CLOSE clears it through the same door, proven
 * live on #7). One slot: the NEWEST registration holds it (#7's live round
 * showed designers APPEND a registration per revision — oldest-first served
 * a stale label all round, and a revision that moved ports would have
 * pinned the glass to the dead one). The two
 * waiting truths read differently on the glass: a free slot ("awaiting the
 * next design task" — which is also the honest post-lock state) vs a dead
 * server behind an occupied slot ("the preview server went down"). */
export type StudioState = {
    mode: "waiting";
    reason: string;
} | {
    mode: "live";
    url: string;
    route: string;
    label: string;
    from: string;
    at: string;
    key: string;
    proxyPort?: number;
};
export declare function deriveStudioState(previews: Preview[], probeOk: boolean, proxyPort?: number): StudioState;
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
