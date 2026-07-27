// The heart (PLAN §2.2): manifest + staffing → the exact Pi invocation.
// Pure — no I/O, no environment reads. P1-5's golden tests pin every flag.
import { join, resolve } from "node:path";
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
export function buildInvocation(loadout: Loadout, staffed: Staffed, paths: Paths): Invocation {
  const brain = (rel: string) => resolve(paths.brainRoot, rel);
  const argv: string[] = ["pi"];

  if (staffed.model !== "") argv.push("--model", staffed.model);
  argv.push("--tools", loadout.policy.tools);
  argv.push("--thinking", loadout.policy.thinking);

  // Full-auto posture (run #7 ask): pi runs its tools without per-command
  // prompts already; --approve also trusts the project's own pi files for this
  // run, so a fresh attach never stalls on a first-touch trust prompt. Contained
  // by the same wall the seat launches inside (pi manifest seats are sandboxed).
  argv.push("--approve");

  argv.push("--append-system-prompt", brain(loadout.binder));
  for (const f of loadout.append_system) argv.push("--append-system-prompt", brain(f));

  argv.push("--no-skills");
  for (const s of loadout.skills) argv.push("--skill", brain(s));

  argv.push("--no-prompt-templates");
  for (const t of loadout.prompt_templates) argv.push("--prompt-template", brain(t));

  if (loadout.extensions.length === 0) argv.push("--no-extensions");

  argv.push("--session-dir", join(paths.projectRoot, ".agents", "state", "sessions", loadout.seat));

  return { argv, cwd: paths.projectRoot };
}

/** Single-quote args for typing into a pane's shell prompt. */
export function toShellCommand(inv: Invocation): string {
  const q = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);
  return inv.argv.map(q).join(" ");
}
