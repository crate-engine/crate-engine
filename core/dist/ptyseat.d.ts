/** The interactive (TUI) argv for one agent — the same session the headless
 * door resumes, opened the way the CLI was built to be used. Permission
 * posture (REVISED by Adam, 2026-08-11, after real driving): a WALLED wheel
 * bypasses claude's own approvals, same as the headless seats — approving
 * every edit was pure friction when the wall already cages all writes to
 * the project + doors. No wall → no bypass, same law as everywhere. */
export declare function buildInteractiveInvocation(agentArg: string, opts?: {
    sessionId?: string;
    model?: string;
    walled?: boolean;
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
    write(data: Buffer): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    subscribe(cb: (ev: TtyEvent) => void): () => void;
    /** Everything the terminal has shown so far (ring-capped) — the replay a
     * (re)connecting viewer paints before going live. */
    replay(): Buffer;
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
}
/**
 * Open (or reattach) the seat's interactive door. Refuses `busy` while a
 * headless turn is mid-flight — two doors, never two writers on one session.
 * Throws nothing: wall refusals and spawn failures come back as { error }.
 */
export declare function startSeatTty(opts: StartTtyOpts): Promise<StartTtyResult>;
/** Close a seat's TTY (the UI's give-back-the-keys). No-op when none. */
export declare function stopSeatTty(projectRoot: string, seat: string): boolean;
