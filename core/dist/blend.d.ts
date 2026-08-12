import { type Message } from "./mailbox.js";
import { type TurnResult } from "./runner.js";
import type { Seat } from "./manifest.js";
import type { TurnUsage } from "./turn.js";
export type BlendCli = "claude" | "pi" | "codex";
export declare function isBlended(conf: Record<string, string>, seat: Seat): boolean;
/** Per-seat persistence override (locked Q1 safety valve): a worker seat
 * with BLEND_<PREFIX>_PERSIST=1 keeps its session across task boundaries so
 * quality claims can be tested empirically, never argued from theory. */
export declare function persistOverridden(conf: Record<string, string>, seat: Seat): boolean;
/** Eligibility = a live-verified TUI-queueing + session-file shape. All
 * three were probed tonight (2026-08-12); anything else stays on the proven
 * headless path with a plain-words reason — fail-open, never a dead seat. */
export declare function blendEligible(agentArg: string): {
    ok: true;
    cli: BlendCli;
} | {
    ok: false;
    reason: string;
};
export declare function newDeliveryId(): string;
/** The delivery block the engine pastes into the live session. The header's
 * #id is the verification marker AND the human-visible dedupe handle: a
 * REDELIVERY header makes an accidental duplicate visible + ignorable.
 * Emits NO control characters — submit (\r) is the injector's job. An
 * orientation block (fresh session's first delivery) rides between the
 * header and the mail so the pane VISIBLY shows the re-orientation (PDR S3:
 * a refresh restarts the session and it re-reads its checkpoint on screen). */
export declare function renderMailBlock(msgs: Message[], id: string, redelivery?: boolean, orientation?: string): string;
/** The compact re-orientation a FRESH session's first delivery carries — the
 * blended twin of composeTurnPrompt's non-resumed orientation (turn.ts). A
 * persistent/resumed session already holds its binder in context (speed law)
 * and gets mail alone; a fresh one must be pointed at its laws + live state
 * or the first brief lands on a blank slate. Pure text, no control chars. */
export declare function renderOrientation(seat: string): string;
/** True iff this session has already received an engine delivery — every
 * delivery header starts "[team mail #", and it lands as a USER record. The
 * verifier's own user-only filter is reused verbatim, so an assistant merely
 * QUOTING a header can never mark a fresh session as oriented. */
export declare function sessionOriented(jsonlText: string | undefined, cli: BlendCli): boolean;
export declare const BLEND_QUIET_MS = 3000;
export declare const BLEND_LONG_QUIET_MS = 30000;
/** The engine yields to the human (locked Q2). A dirty composer (printable
 * keys since the last CR/Esc — a likely half-typed draft) demands the LONG
 * quiet: our CR would submit their draft together with the mail. Never
 * typed at all = quiet. */
export declare function composerQuiet(state: {
    lastHumanInputMs?: number;
    composerDirty: boolean;
}, nowMs: number, quietMs?: number, longQuietMs?: number): boolean;
/** pi keys its session dir by cwd (live probe, superman pi 0.84.1):
 * /home/x/scratch/wd → ~/.pi/agent/sessions/--home-x-scratch-wd--/ */
export declare function piSessionsDir(cwd: string, home: string): string;
/** Every *.jsonl in a session dir touched at/after sinceMs, NEWEST FIRST
 * (full paths). The list form matters for all-seats coherence: several
 * blended seats share one cwd, so one dir holds several live sessions at
 * once — see findBlendSessionCandidates. */
export declare function sessionFilesIn(dir: string, sinceMs: number): string[];
/** Newest *.jsonl in a session dir touched at/after sinceMs → full path. */
export declare function newestSessionFileIn(dir: string, sinceMs: number): string | undefined;
/** codex rollout files are date-keyed, NOT cwd-keyed — the first line is a
 * session_meta whose payload.cwd names the seat's dir (live probe shape). */
export declare function codexRolloutMatches(firstLine: string, cwd: string): boolean;
export declare function codexSessionIdOf(firstLine: string): string | undefined;
/** Scan ~/.codex/sessions/YYYY/MM/DD for EVERY rollout-*.jsonl born at/after
 * sinceMs whose session_meta cwd matches the seat, newest first. Spans the
 * spawn day and the next (a session opened before midnight writes on into
 * the new day only inside the same file, but the spawn itself may land
 * either side). */
export declare function codexRolloutsSince(home: string, cwd: string, sinceMs: number): string[];
export declare function findCodexRollout(home: string, cwd: string, sinceMs: number): string | undefined;
export interface BlendSession {
    path: string;
    sessionId?: string;
}
/**
 * EVERY live-session candidate born/touched at/after sinceMs, newest first.
 * ALL-SEATS COHERENCE (PDR S3): with the whole team blended, five seats
 * share ONE cwd — so claude's munged project dir, pi's munged sessions dir,
 * and codex's cwd-matched rollouts each hold SEVERAL seats' sessions at
 * once, and "the newest file" can be ANOTHER seat's session. Discovery
 * therefore cannot pick-and-trust: the supervisor verifies deliveries
 * against every candidate and PINS the file the delivery marker actually
 * landed in (self-verifying discovery — the same physics as delivery
 * verification, so a mis-pin is impossible).
 */
export declare function findBlendSessionCandidates(cli: BlendCli, opts: {
    projectRoot: string;
    home?: string;
    sinceMs: number;
}): BlendSession[];
/** Newest candidate — the single-seat fast path (and the pre-pin fallback
 * for gauges/responding, where best-effort is honest enough). */
export declare function findBlendSession(cli: BlendCli, opts: {
    projectRoot: string;
    home?: string;
    sinceMs: number;
}): BlendSession | undefined;
/** True iff the marker appears in a USER-authored record of the session
 * file. The user-only filter is load-bearing: the assistant's reply echoes
 * the marker in later lines, and an echo is not a delivery. Malformed and
 * partial trailing lines are skipped, never thrown on. */
export declare function verifyDelivered(jsonlText: string, marker: string, cli: BlendCli): boolean;
/** Gauge fuel without headless stream-json: the LAST assistant record's
 * message.usage. Context fullness = input + cache-read tokens. Absent or
 * unparseable → undefined — degrade honestly, never fake a gauge. The exact
 * nesting is a swappable pure parser by design (pin against live runs). */
export declare function sessionUsage(jsonlText: string): TurnUsage | undefined;
/** Per-CLI delivery physics, all live-probed. The submit gap is uniform at
 * 1s: codex groups literal-text+immediate-CR as one paste (the CR becomes a
 * composer newline — reproduced), claude proved 400ms, pi tolerated 0 — one
 * safe gap for all three. Verify ceilings differ because pi/codex write the
 * queued message to the session file only when the in-flight turn ENDS
 * (timing law), so the window must span the turn remainder; claude wrote
 * mid-turn in ~1.2s. */
export declare const CLI_DELIVERY: Record<BlendCli, {
    submitDelayMs: number;
    verifyTimeoutMs: number;
    verifyPollMs: number;
}>;
/** The delivery writer's view of a pane — the engine door plus the human
 * timestamps the quiet gate reads (ptyseat's TtySeat satisfies this). */
export interface BlendTtyHandle {
    inject(data: Buffer | string): void;
    lastHumanInputMs?: number;
    composerDirty: boolean;
    exited?: {
        code: number;
    };
}
export interface DeliverOpts {
    tty: BlendTtyHandle;
    msgs: Message[];
    cli: BlendCli;
    /** Current session-jsonl text; undefined while the file does not exist yet. */
    readSession: () => string | undefined;
    /** Fresh session's first delivery: the visible re-orientation block. */
    orientation?: string;
    id?: string;
    quietMs?: number;
    longQuietMs?: number;
    quietPollMs?: number;
    submitDelayMs?: number;
    verifyTimeoutMs?: number;
    verifyPollMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}
export interface DeliveryOutcome {
    ok: boolean;
    id: string;
    attempts: number;
    /** ms from the attempt's CR to on-disk verification. */
    verifyMs?: number;
    error?: string;
}
/**
 * Deliver one mail batch into a live blended session, verified. Waits
 * INDEFINITELY for a quiet composer (the engine yields to the human; mail
 * queues losslessly meanwhile — locked Q2). Miss → ONE redelivery with a
 * visible REDELIVERY header (D11: duplication is the accepted failure mode,
 * loss is not) → honest failure; the CALLER keeps the mail queued and stamps.
 */
export declare function deliverToBlendedSeat(o: DeliverOpts): Promise<DeliveryOutcome>;
/** Task-ending events in .agents/state/events.log — agentctl writes accepted
 * lines as `[iso] TRANSITION actor=… state=…`; a task ends when it lands at
 * idle: CLOSE, ABANDON, RESEARCH_DONE (state-machine.yaml is the authority;
 * REJECTED lines never count). */
export declare function isTaskEndEvent(line: string): boolean;
export declare function taskEndsIn(chunk: string): number;
/** Which blended seats get fresh eyes at a task boundary: WORKERS only (the
 * orchestrator persists — its memory is the project's arc), minus any seat
 * whose rig.conf persistence override is on (the Q1 safety valve). */
export declare function seatsToReset(blendedSeats: Seat[], conf: Record<string, string>): Seat[];
export interface StaleTracker {
    isStale(seat: string): boolean;
    markStale(seat: string): void;
    clear(seat: string): void;
}
export declare function createStaleTracker(): StaleTracker;
/**
 * Watch events.log for task ends and mark the resettable blended seats
 * stale. The reset itself is LAZY — the next delivery respawns (memory
 * within a task, clean eyes between tasks; nothing is torn down mid-idle
 * for no reader). Returns the unwatch. Poll-based (1s): events.log lives on
 * plain disk and agentctl appends whole lines; a missed instant costs one
 * tick, and fs.watch's rename semantics across editors/rotations are not
 * worth the fragility here.
 */
export declare function watchTaskEnds(projectRoot: string, onTaskEnd: () => void, opts?: {
    pollMs?: number;
}): () => void;
/** codex's first launch in a new cwd blocks on a directory-trust dialog
 * (live-probed; fires per rig dir, then remembered) — with fresh-per-task
 * workers that is the FIRST spawn in every rig. The pending modal would eat
 * an injected CR, so the supervisor answers it before marking the seat
 * ready. */
export declare function needsTrustAnswer(replayText: string): boolean;
/** claude's folder-trust dialog (live proof, 2026-08-12): a FRESH claude TUI
 * in this rig dir blocks on "Is this a project you created or one you
 * trust?" even though ~/.claude.json is a wall door — the accepted flag
 * never persists from inside the wall (observed empty project entry after an
 * accepted dialog), so with fresh-per-task workers the dialog is back on
 * EVERY respawn and would eat the first delivery's paste. Detection is over
 * ANSI-normalized, whitespace-collapsed replay: the live pane renders its
 * spacing as cursor-forward sequences, so a literal-space needle never
 * matches the raw stream. */
export declare function needsClaudeTrustAnswer(replayText: string): boolean;
/** Answer claude's folder-trust dialog with a bare CR — option 1 ("Yes, I
 * trust this folder") is preselected. The needle is STRICT to this dialog by
 * design: the bypass-permissions warning defaults to "No, exit", so a blind
 * CR into the wrong modal must be impossible. */
export declare function claudeTrustHandshake(readReplay: () => string, tty: Pick<BlendTtyHandle, "inject">, opts?: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
}): Promise<boolean>;
export declare function codexTrustHandshake(readReplay: () => string, tty: Pick<BlendTtyHandle, "inject">, opts?: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
}): Promise<boolean>;
export interface BlendedTurnOpts {
    projectRoot: string;
    seat: string;
    /** Staffed agent (any alias); normalized + eligibility-checked by the caller. */
    cli: BlendCli;
    agentArg: string;
    /** The live pane, or undefined when it died — the supervisor's registry. */
    getTty: () => BlendTtyHandle | undefined;
    /** Kill (if live) + spawn fresh — the ONE respawn seam serving boot,
     * crash-recovery, D12 refresh, and per-task reset. */
    respawn: (reason: string) => Promise<BlendTtyHandle>;
    /** Current session-jsonl text (discovery/caching owned by the supervisor). */
    readSession: () => string | undefined;
    /** The discovered session id, for the sessionFile persist + stamps. */
    currentSessionId: () => string | undefined;
    stale: StaleTracker;
    /** The agent is mid-response (session file still growing) — a lazy reset
     * defers on this, never tearing a running turn in half (the D12 rail in
     * blended form; a blended seat has no turn jsonl for stateIsFresh). */
    responding?: () => boolean;
    /** Set true after each sessionFile persist; consumed when the file is
     * found DROPPED by an outside hand — agentctl's verify-dispatch fresh-eyes
     * (main e84bd0d) and D12's refreshSeat both rm turns/<seat>/session.json
     * as THE sanctioned fresh-start lever. The blended seat honors that same
     * lever (integration, not duplication): drop found → fresh respawn before
     * this delivery. */
    persistRef?: {
        persisted: boolean;
    };
    /** After on-disk verification, BEFORE the sessionFile persist: the
     * supervisor pins which candidate file the marker landed in (all-seats
     * coherence — see findBlendSessionCandidates). */
    onVerified?: (deliveryId: string) => void;
    /** Fresh session's first delivery carries the visible re-orientation;
     * default infers from the session text (no prior "[team mail #" user
     * record = fresh). The supervisor overrides with spawn-level truth (a
     * crash-RESUMED session is already oriented even though unpinned). */
    needsOrientation?: () => boolean;
    /** Composer-ready settle after any spawn (probe-1 lesson: a startup modal
     * ate the first paste — never deliver into a just-born TUI instantly). */
    spawnSettleMs?: number;
    quietMs?: number;
    longQuietMs?: number;
    quietPollMs?: number;
    submitDelayMs?: number;
    verifyTimeoutMs?: number;
    verifyPollMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}
/**
 * One blended "turn": drain the seat's unread mail as ONE verified delivery
 * into its live session. Mirrors runTurn's contract exactly so runnerLoop's
 * machinery (wake, retries, dead-letter, backoff) is inherited verbatim via
 * the runTurnImpl seam. Ack absorption and at-least-once are the runner's
 * rules, reused: complete() ONLY after on-disk verification.
 */
export declare function blendedTurn(o: BlendedTurnOpts): Promise<TurnResult>;
export interface BlendedLoopOpts extends BlendedTurnOpts {
    pollMs?: number;
    maxRetries?: number;
    /** Staffed model — the gauge's window denominator (D12 bands). */
    model?: string;
    /** D12 auto-mode for blended seats (rig.conf CONTEXT_AUTO_REFRESH, same
     * knob as headless): the INHERITED runnerLoop hook drops sessionFile at
     * the ceiling, and the external-drop lever turns that into a VISIBLE
     * fresh respawn at the next delivery — one lever, both worlds. */
    contextAutoRefresh?: boolean;
}
/**
 * The flagged seat's standing loop: runnerLoop with the delivery turn
 * injected. Runs IN the engine-server process (the PTY registry is
 * in-process state — a `crate runner` child could never reach the pane), so
 * the orphan watchdog is neutralized: the supervisor's lifetime IS ours.
 */
export declare function blendedLoop(o: BlendedLoopOpts): Promise<void>;
