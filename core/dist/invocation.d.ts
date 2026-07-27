import type { Loadout } from "./manifest.js";
import type { Staffed } from "./staffing.js";
export interface Paths {
    brainRoot: string;
    projectRoot: string;
}
export interface Invocation {
    argv: string[];
    cwd: string;
}
/**
 * Flag decisions, each traceable to a Phase-0 finding:
 * - `--tools` = policy.tools verbatim: a restricted allowlist does NOT hide
 *   explicit `--skill` entries (verified live, P1-5 pre-test 2026-07-04).
 * - `--no-skills` / `--no-prompt-templates` always: discovery off, the seat's
 *   loadout is exactly the manifest (P0-4 finding 2). User additions come via
 *   the overlay, which composes into the manifest, not around it.
 * - `--no-extensions` ONLY when the manifest lists none: explicit `-e` paths
 *   survive `-ne`, but npm/project-scoped extensions load via settings
 *   discovery, which `-ne` would kill. Extension-having seats are a Phase-2
 *   concern (no MVP seat needs one yet); revisit the flag there.
 * - `--session-dir` under the project's .agents/state — session state is
 *   project-tier (PLAN §2.1).
 * - AGENTS.md discovery stays ON (no --no-context-files): it's the standards
 *   doc every binder points at.
 */
export declare function buildInvocation(loadout: Loadout, staffed: Staffed, paths: Paths): Invocation;
/** Single-quote args for typing into a pane's shell prompt. */
export declare function toShellCommand(inv: Invocation): string;
