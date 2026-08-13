/** The interactive (TUI) argv for one agent — the same session the headless
 * door resumes, opened the way the CLI was built to be used. Permission
 * posture (REVISED by Adam, 2026-08-11, after real driving): a WALLED wheel
 * bypasses claude's own approvals, same as the headless seats — approving
 * every edit was pure friction when the wall already cages all writes to
 * the project + doors. No wall → no bypass, same law as everywhere. */
/** The identity a wheel session is born with — who it is, where its laws
 * live, and the one law that must survive even a human conversation. */
export declare function seatIdentityPrompt(seat: string): string;
export declare function buildInteractiveInvocation(agentArg: string, opts?: {
    sessionId?: string;
    model?: string;
    walled?: boolean;
    seat?: string;
}): string[];
/** The seat's session id as the TTY door should open it. Mirrors the
 * runner's semantics (pi pre-mints so both doors share one session). */
export declare function ttySessionId(projectRoot: string, seat: string, agentArg: string): string | undefined;
/** Claude Code stores sessions per munged-cwd: non-alphanumerics become "-"
 * (verified against a live ~/.claude/projects). */
export declare function claudeProjectDir(projectRoot: string, home: string): string;
/** Newest session file (basename sans .jsonl) touched at/after sinceMs. */
export declare function newestClaudeSession(dir: string, sinceMs: number): string | undefined;
/**
 * The handback seam: after a claude TUI closes, point the seat's session
 * file at the session the human actually drove (interactive resume FORKS a
 * new id — without this, the next headless turn would resume the pre-drop-in
 * memory and lose everything the human did). Falls back to scanning every
 * claude project dir when the munged dir yields nothing (belt + braces on
 * the munge rule). No-op for codex/pi (ids observed stable across doors —
 * live-confirm rides the first battle-test drop-in).
 */
export declare function repointSessionAfterTty(projectRoot: string, seat: string, agentArg: string, sinceMs: number, home?: string): string | undefined;
export interface TtyEvent {
    data?: Buffer;
    exit?: {
        code: number;
    };
}
/** Blended-pane (PDR blended-pane, S1): the quiet-composer gate is pure
 * keystroke-timestamp inference — write() is the ONE human chokepoint (web
 * cockpit xterm → POST /api/tty/input → here), so no screen parsing is ever
 * needed. composerDirty tracks a likely half-typed draft: printable bytes set
 * it; CR/Ctrl+C/Esc clear it (submit/cancel empties the composer). CSI
 * sequences (arrow keys etc.) are stripped first — cursor movement is not
 * typing, and counting the 'A' of ESC[A as a draft would demand the long
 * quiet for every arrow press. */
export declare function updateComposerDirty(prev: boolean, data: Buffer): boolean;
/** Blended pi seats crash under old system node (live probe, superman
 * 2026-08-12: pi 0.84.1 + node v20 dies at import — undici
 * markAsUncloneable TypeError; works under node >= 22). Pick the newest
 * nvm-installed node >= 22 so the spawn env can prepend its bin. Pure over
 * an injected version list. */
export declare function pickPiNodeVersion(versions: string[]): string | undefined;
export interface TtySeat {
    seat: string;
    projectRoot: string;
    agent: string;
    startedAtMs: number;
    cols: number;
    rows: number;
    exited?: {
        code: number;
    };
    /** Blended-pane: this PTY is an engine-owned live session (no attended
     * hold, no hand-back; the engine delivers team mail into it). */
    blended?: boolean;
    /** Last HUMAN keystroke (write()); inject() never bumps it — the quiet-
     * composer gate must measure only the human. */
    lastHumanInputMs?: number;
    /** Likely half-typed human draft in the composer (see updateComposerDirty). */
    composerDirty: boolean;
    /** The live session id, once the blend supervisor discovers it. */
    sessionId?: string;
    /** The HUMAN door: stamps lastHumanInputMs + composerDirty. */
    write(data: Buffer): void;
    /** The ENGINE door: writes to the PTY without touching the human
     * timestamps (deliveries must not look like typing to the quiet gate). */
    inject(data: Buffer | string): void;
    /** Multi-view policy (FLAWS 2026-08-12, smallest-client-wins): pass a
     * stable per-view `client` id and the PTY sizes to the MIN of every fresh
     * proposal (tmux's rule) — two views of one seat never fight. Views
     * heartbeat their dims (~10s); a closed view's proposal expires by TTL.
     * A client-less call applies the dims directly (legacy/tests). */
    resize(cols: number, rows: number, client?: string): void;
    kill(): void;
    subscribe(cb: (ev: TtyEvent) => void): () => void;
    /** Everything the terminal has shown so far (ring-capped) — the replay a
     * (re)connecting viewer paints before going live. */
    replay(): Buffer;
    /** Turn-boundary verify (2026-08-13): bytes this pane emitted in the last
     * <windowMs> — the busy/quiet signal. A working TUI STREAMS (spinners,
     * tool progress repaints); an idle prompt blinks ~8 B/s (live ledger
     * figure). The delivery verifier reads this past its base window: still
     * streaming = mid-turn, judgment defers to the boundary. */
    outputBytesSince(windowMs: number): number;
}
export declare function liveTty(projectRoot: string, seat: string): TtySeat | undefined;
/** Every live TTY of one project — the multiplexed stream's roster. */
export declare function liveTtyList(projectRoot: string): TtySeat[];
export type StartTtyResult = {
    ok: true;
    tty: TtySeat;
    reattached: boolean;
} | {
    ok: false;
    busy: true;
} | {
    ok: false;
    error: string;
};
export interface StartTtyOpts {
    projectRoot: string;
    seat: string;
    agent: string;
    model?: string;
    cols?: number;
    rows?: number;
    home?: string;
    /** Blended-pane (PDR): spawn as an engine-owned live session — no attended
     * hold (the seat is never held), no session re-point on exit (one door,
     * nothing forks; the blend supervisor owns respawn). */
    blended?: boolean;
    /** Tests only: replace the real agent argv (and skip the wall) — the PTY
     * lifecycle/registry seams need a spawnable stub where no agent CLI exists,
     * the same reason runner.ts carries invocationOverride. */
    argvOverride?: string[];
    /** Tests only: shrink the multi-view size-proposal TTL (default 25s) so
     * expiry is provable without a 25s wait. */
    sizeProposalTtlMs?: number;
}
/**
 * Open (or reattach) the seat's interactive door. Refuses `busy` while a
 * headless turn is mid-flight — two doors, never two writers on one session.
 * Throws nothing: wall refusals and spawn failures come back as { error }.
 */
export declare function startSeatTty(opts: StartTtyOpts): Promise<StartTtyResult>;
/** Close a seat's TTY (the UI's give-back-the-keys). No-op when none. */
export declare function stopSeatTty(projectRoot: string, seat: string): boolean;
/**
 * Evict a seat's TTY NOW: kill it AND drop it from the registry immediately,
 * not on the async exit event. The blend relaunch lesson (live proof,
 * 2026-08-12): a D12 refresh stops the old supervisor and starts its
 * successor in the SAME tick — the successor's eager spawn found the dying
 * pane still registered, REATTACHED to it, and the promised visible fresh
 * pane only appeared at the next delivery. Eviction closes that window; the
 * old process still dies by kill(), and onExit's guarded delete keeps a late
 * exit from unregistering the successor.
 */
export declare function evictSeatTty(projectRoot: string, seat: string): boolean;
