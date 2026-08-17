export type SandboxPolicy = "readonly" | "standard" | "none";
/** The slice of a loadout the generator needs (decoupled for tests/tools). */
export interface SandboxSpec {
    seat: string;
    sandbox: SandboxPolicy;
    /** Extra write doors: `~/`-prefixed = home, absolute = as-is, else project-relative. */
    doors: string[];
}
export interface SandboxPaths {
    brainRoot: string;
    /** MUST be the real (symlink-resolved) path — Seatbelt matches resolved paths. */
    projectRoot: string;
    home: string;
}
export declare class SandboxError extends Error {
}
/** Expand one door entry to an absolute path. */
export declare function expandDoor(door: string, paths: SandboxPaths): string;
/** Escape a literal path for embedding inside a Seatbelt regex filter. */
export declare function regexEscapePath(p: string): string;
/**
 * Render one door entry as a Seatbelt filter line. Two forms:
 * - a path (`~/…`, absolute, or project-relative) → `(subpath "…")`
 * - `regex:<pattern>` → `(regex #"<pattern>")`, with `{{PROJECT}}`/`{{HOME}}`/
 *   `{{PARENT}}` tokens substituted as regex-ESCAPED literal paths — the
 *   narrow-door form for tools with genuinely variable-suffix paths. Prefer
 *   subpath doors; reach for regex only when the path truly varies AND the
 *   rig is macOS-only, because the bwrap backend cannot express a regex as a
 *   bind mount (it SKIPS + reports them). No shipped manifest uses one — the
 *   nm-gate worktrees moved to a fixed `../.nmgate-wt` subpath door (T7-0).
 *
 * Project-relative doors expand against the REAL projectRoot (both launchers
 * realpath it first — Seatbelt matches resolved paths, bwrap binds host
 * paths), so the shell side must derive matching paths physically too:
 * precheck.sh/nm-gate `pwd -P` their repo root so the `../.nmgate-wt` parent
 * is the same real-path sibling this expansion opens (nmgate-ro-mount).
 */
export declare function renderDoor(door: string, paths: SandboxPaths): string;
/**
 * Harness-state write doors per agent (P3-8): the templates carry pi's
 * `~/.pi` door inline; other harnesses declare theirs here and the launcher
 * merges them into the seat's doors. Claude Code writes its session/config
 * state under `~/.claude` plus the root-level json (+ its backup).
 */
export declare function stateDoorsFor(agent: string): string[];
/**
 * CE-129 (battle test 2026-08-17): pre-seed Claude Code's folder-trust for the
 * attached project so a walled seat never blocks on the interactive dialog.
 *
 * WHY the dialog cannot save its own answer inside the wall — claude v2 writes
 * config as `~/.claude.json.tmp.<pid>.<hash>` then rename()s it over
 * `~/.claude.json` (strace-proven on Superman). The tmp name matches no door,
 * and a rename over a single-file bind mount is impossible on Linux regardless
 * — so every in-wall save silently fails, trust never persists, and each boot
 * re-asks. An unanswered prompt is a dead seat: deliveries queue durably but
 * nothing consumes them.
 *
 * WHY seeding is legitimate: `crate open`/attach is the operator deliberately
 * pointing a team at this repo — that IS the trust decision. The engine writes
 * the same key claude's own dialog writes, atomically, from OUTSIDE the wall.
 *
 * Never blocks a spawn: absent config (agent not signed in) or unparseable
 * JSON → false, untouched. Only ever ADDS `hasTrustDialogAccepted: true` for
 * this one project root.
 */
export declare function preseedClaudeProjectTrust(home: string, projectRoot: string): boolean;
/**
 * Render a seat's profile text from the brain's template. Returns undefined
 * for `sandbox: none` (no wrap). Doors from the manifest expand at the
 * template's `{{DOORS}}` marker line; a doorless render strips the marker.
 */
export declare function renderProfile(spec: SandboxSpec, paths: SandboxPaths): string | undefined;
export interface BwrapRender {
    /** bwrap arguments (no leading binary — the caller prepends the bwrap path). */
    args: string[];
    /** Doors the backend could not express (regex doors) — callers must log these loudly. */
    skippedDoors: string[];
    /** Absent file-doors bound try-only: the path does not exist so writes to it
     * are denied until it does (the Seatbelt "write to a not-yet-existing path"
     * semantic has no bwrap bind analog). Reported, never silently dropped. */
    absentDoors: string[];
}
/**
 * Render a seat's wall as bwrap arguments. Returns undefined for sandbox:
 * none. The base UNSHARES the pid/ipc/uts/cgroup namespaces (net stays shared
 * for `network: true` seats) so a walled seat cannot see or signal the
 * supervisor / sibling seats, and the fresh `--proc` reflects only the
 * sandbox — matching Seatbelt's per-process isolation. Missing dir-doors are
 * materialized (a bind mount needs a real source — Seatbelt allowed
 * not-yet-existing paths, bwrap cannot); missing file-doors ride --bind-try
 * (absent → reported in absentDoors, never a hard launch failure).
 */
export declare function renderBwrapArgs(spec: SandboxSpec, paths: SandboxPaths): BwrapRender | undefined;
/** First `bwrap` on PATH, or undefined (D7: availability is a fail-loud cli_dep). */
export declare function findBwrap(env?: NodeJS.ProcessEnv): string | undefined;
export interface WallPlan {
    backend: "seatbelt" | "bwrap";
    /** Prepend to the harness argv: the wall wrap. */
    argvPrefix: string[];
    /** Doors this backend could not express (bwrap regex doors) — log loudly. */
    skippedDoors: string[];
    /** Absent file-doors (bwrap only) — writes there are denied until the path
     * exists; log so the create-inside-the-wall gap is visible, never silent. */
    absentDoors: string[];
}
/**
 * The one platform dispatcher (D7): the same SandboxSpec becomes a Seatbelt
 * profile wrap on macOS and a bwrap wrap on Linux. Returns undefined for
 * sandbox: none; throws SandboxError when the platform has no wall backend
 * (a wall the policy declares but the host cannot render must fail LOUD).
 */
export declare function renderWallPlan(spec: SandboxSpec, paths: SandboxPaths, outDir: string, opts?: {
    platform?: NodeJS.Platform;
    bwrapBin?: string;
}): WallPlan | undefined;
/** Narrow a full loadout to the generator's input. */
export declare function specFromLoadout(loadout: {
    seat: string;
    policy: {
        sandbox: SandboxPolicy;
        sandbox_doors: string[];
    };
}): SandboxSpec;
/**
 * Render + write `<outDir>/<seat>.sb`; returns the profile path, or undefined
 * for `sandbox: none`.
 */
export declare function writeProfile(spec: SandboxSpec, paths: SandboxPaths, outDir: string): string | undefined;
