/** Resolve a binary on PATH (injectable for hermetic tests). */
export declare function whichBin(name: string, opts?: {
    path?: string;
}): string | undefined;
/** The harness binary a staffable agent runs as (undefined = adapter-specific,
 * not detectable here — treated as the agent's own responsibility). */
export declare function binaryFor(agent: string): string | undefined;
export interface AgentProblem {
    agent: string;
    fix: string;
}
/** The auth-marker half of detection (markers only — binary presence is
 * agentProblem's job). Kept verbatim from the run #3/#5 findings. */
export declare function seatAuthProblem(agent: string, home: string, models?: string[]): AgentProblem | undefined;
/** Full detection for one agent: not installed beats not signed in; undefined
 * means READY (installed + authenticated for the given models' providers).
 * `deep` (run #10): the ~/.claude.json markers can say "signed in" while the
 * REAL credential (macOS Keychain) is stale — e.g. after claude auto-updates,
 * the keychain ACL no longer matches the new binary and a WALLED seat can't
 * pop the approval prompt, so it boots "Not logged in" despite green markers.
 * Deep asks claude itself (`claude auth status` → loggedIn) — used at the
 * moments of truth (the Check screen's doctor row and the boot refusal),
 * not on every dashboard poll. */
export declare function agentProblem(agent: string, home: string, models?: string[], opts?: {
    path?: string;
    deep?: boolean;
}): AgentProblem | undefined;
export interface AgentStatus {
    agent: string;
    /** Human label for the harness. */
    label: string;
    /** Titles of the staffed seats that run on this agent. */
    seats: string[];
    installed: boolean;
    /** installed AND authenticated for every staffed model's provider. */
    ready: boolean;
    /** The honest one-liner when not ready. */
    fix?: string;
}
export declare function agentLabel(agent: string): string;
/**
 * Per-agent readiness for the STAFFED seats. Agent resolution is EXACTLY the
 * boot's (resolveSeat over rig.conf → user defaults → built-in), so what this
 * reports matches what up() will refuse on.
 */
export declare function agentStatus(opts: {
    home: string;
    project?: string;
    path?: string;
}): AgentStatus[];
