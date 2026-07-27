// P4-0/P4-6: the user tier (~/.crate) — PLAN §2.1 layout, verbatim.
//   defaults.yaml  global staffing + minimal prefs (never committed)
//   overlay/       brain customizations, mirrors brain paths (§2.6)
//   engine/        the canonical brain clone — PRISTINE, never edited
// Setup is idempotent: re-runs heal missing pieces and never overwrite user
// content. `update` is a fast-forward on the pristine clone plus the overlay
// compatibility pass (P4-6).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentProblem } from "./detect.js";
import { listOverlayEntries, readBaseHashes, writeBaseHashes, hashFile } from "./overlay.js";

/** Product default brain origin: the private DISTRIBUTION repo (product-only
 * snapshots published by dev/dist-repo/publish.sh — testers get this; the
 * workshop repo with the internal record stays private to us). Dev setup
 * clones from the local working repo instead — gate answer Q3. */
export const PRODUCT_ENGINE_ORIGIN = "https://github.com/crate-engine/crate-engine.git";

export interface TierPaths {
  root: string;
  defaultsFile: string;
  overlayDir: string;
  engineDir: string;
}

export class UserTierError extends Error {}

export function tierPaths(home: string): TierPaths {
  if (!home) throw new UserTierError("cannot locate the user tier without HOME");
  const root = join(home, ".crate");
  return {
    root,
    defaultsFile: join(root, "defaults.yaml"),
    overlayDir: join(root, "overlay"),
    engineDir: join(root, "engine"),
  };
}

const DEFAULTS_SEED = `# ~/.crate/defaults.yaml — your global staffing defaults (user tier).
# Seeded with the battle-tested staffing so a fresh account boots the REAL
# team (gate-day run #3 finding: an empty seed silently staffed every seat
# on the built-in fallback). Edit here or on the app's staffing screen;
# a repo's .agents/rig.conf overrides per seat. Never committed.
seats:
  orchestrator: { agent: pi, model: openai-codex/gpt-5.5 }
  coder: { agent: claude, model: opus }
  reviewer: { agent: pi, model: openai-codex/gpt-5.5 }
  designer: { agent: pi, model: openai-codex/gpt-5.5 }
  tester: { agent: pi, model: openai-codex/gpt-5.5 }
#
# prefs:                                   # minimal, all optional
#   preview_provider: tailscale            # none | tailscale | custom
#   brand: { name: Dev Preview, accent: "#3b82f6" }
`;

/** Seed the verified staffing when no defaults exist yet (the installer
 * clones the engine without running setup — the app seeds on first start).
 * Detection-aware (P6-6 direction change): the engine assumes agents are
 * already installed+signed in and never installs them — so when the verified
 * Coder harness (claude) isn't ready on this machine but pi is, the seed
 * falls the Coder back to pi rather than pre-selecting a seat that can't
 * boot. The user can re-staff on the staffing screen at any time. */
export function seedDefaultsIfAbsent(home: string, opts: { path?: string } = {}): boolean {
  const t = tierPaths(home);
  if (existsSync(t.defaultsFile)) return false;
  mkdirSync(t.root, { recursive: true });
  let seed = DEFAULTS_SEED;
  const claudeReady = agentProblem("claude", home, ["opus"], opts) === undefined;
  const piReady = agentProblem("pi", home, ["openai-codex/gpt-5.5"], opts) === undefined;
  if (!claudeReady && piReady) {
    seed = seed.replace(
      "  coder: { agent: claude, model: opus }",
      "  coder: { agent: pi, model: openai-codex/gpt-5.5 } # claude not detected on this machine at first start",
    );
  }
  writeFileSync(t.defaultsFile, seed);
  return true;
}

export interface SetupReport {
  actions: string[]; // "cloned engine/ (from <src>)", "wrote defaults.yaml", "kept ..."
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Create/heal the user tier. `engineSource` is a local path or git URL; the
 * dev default (the local working clone) is decided by the CLI, not here.
 */
export function setupTier(home: string, opts: { engineSource: string }): SetupReport {
  const t = tierPaths(home);
  const actions: string[] = [];

  mkdirSync(t.root, { recursive: true });
  if (existsSync(t.overlayDir)) actions.push("kept    overlay/");
  else {
    mkdirSync(t.overlayDir, { recursive: true });
    actions.push("created overlay/");
  }

  if (existsSync(t.defaultsFile)) actions.push("kept    defaults.yaml (yours — not touched)");
  else {
    writeFileSync(t.defaultsFile, DEFAULTS_SEED);
    actions.push("wrote   defaults.yaml (seed — set your team once here)");
  }

  if (existsSync(t.engineDir)) {
    if (!existsSync(join(t.engineDir, ".git"))) {
      throw new UserTierError(
        `${t.engineDir} exists but is not a git clone — move it aside and re-run setup ` +
          `(the engine must stay a pristine fast-forwardable clone).`,
      );
    }
    actions.push("kept    engine/ (existing clone)");
  } else {
    try {
      git(["clone", "--quiet", opts.engineSource, t.engineDir]);
    } catch (e) {
      throw new UserTierError(
        `could not clone the brain from ${opts.engineSource}: ${e instanceof Error ? e.message : e}`,
      );
    }
    actions.push(`cloned  engine/ (from ${opts.engineSource})`);
  }

  return { actions };
}

/**
 * Run #13 (Adam): `crate open` must be PROJECT-ASSOCIATED — with several rigs
 * on one machine, "the last project" is ambiguous. The anchor is the repo
 * itself: a folder with an attached `.agents/` IS a Crate Engine project, so
 * `crate open` run inside one opens THAT project (v1 `crate up` muscle
 * memory). Returns the dir when it is an attached project, else undefined.
 */
export function projectAt(dir: string): string | undefined {
  return existsSync(join(dir, ".agents", "bin")) ? dir : undefined;
}

// ── P6-5: last-project persistence (inheritance #3) ─────────────────────────
// One path in ~/.crate/last-project; a vanished path is ignored on read.

export function writeLastProject(home: string, projectRoot: string): void {
  const t = tierPaths(home);
  if (!existsSync(t.root)) return; // no tier, nothing to persist into
  writeFileSync(join(t.root, "last-project"), `${projectRoot}\n`);
}

export function readLastProject(home: string): string | undefined {
  const f = join(tierPaths(home).root, "last-project");
  if (!existsSync(f)) return undefined;
  const p = readFileSync(f, "utf8").trim();
  return p && existsSync(join(p, ".agents")) ? p : undefined;
}

// ── the app-url handshake ────────────────────────────────────────────────────
// The gui server writes its tokened URL to ~/.crate/app-url; a waiting
// `crate open` reads it to detect an already-running app (T8: the cmux
// pending-open/~/.zprofile bootstrap is gone — `crate open` starts the server
// and opens the app window itself).

export function appUrlPath(home: string): string {
  return join(tierPaths(home).root, "app-url");
}

export interface UpdateReport {
  before: string;
  after: string;
  fastForwarded: boolean;
  /** Overlay entries whose BASE file changed in this update — review them. */
  flagged: Array<{ entry: string; note: string }>;
}

/**
 * P4-6 `crate2 update`: fetch + `--ff-only` merge on the pristine clone
 * (guaranteed to fast-forward because P4-5 never edits it), then the overlay
 * compatibility pass: any overlay entry whose recorded base-file hash changed
 * is FLAGGED plainly — never auto-merged, never dropped. Records refresh after
 * flagging so only NEW base changes flag on the next update.
 */
export function updateEngine(home: string): UpdateReport {
  const t = tierPaths(home);
  if (!existsSync(join(t.engineDir, ".git"))) {
    throw new UserTierError(`no engine clone at ${t.engineDir} — run: crate2 setup`);
  }
  const rev = () => git(["rev-parse", "HEAD"], t.engineDir).trim();

  // Snapshot: make sure every overlay entry has a recorded base hash BEFORE the
  // pull (first-seen = written-against; compose also records as entries appear).
  const entries = listOverlayEntries(t.overlayDir);
  const hashes = readBaseHashes(t.overlayDir);
  for (const e of entries) {
    if (!(e.relPath in hashes)) hashes[e.relPath] = hashFile(join(t.engineDir, e.relPath));
  }
  writeBaseHashes(t.overlayDir, hashes);

  const before = rev();
  git(["fetch", "--quiet", "origin"], t.engineDir);
  try {
    git(["merge", "--ff-only", "--quiet", "@{u}"], t.engineDir);
  } catch (e) {
    throw new UserTierError(
      `the engine clone at ${t.engineDir} did not fast-forward — it has local edits. ` +
        `The clone must stay pristine (customize via ~/.crate/overlay/ instead); ` +
        `power users who forked on purpose: resolve with git in that directory. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
  const after = rev();

  const flagged: UpdateReport["flagged"] = [];
  for (const e of entries) {
    const now = hashFile(join(t.engineDir, e.relPath));
    const was = hashes[e.relPath];
    if (was !== undefined && now !== was) {
      flagged.push({
        entry: e.relPath,
        note:
          now === null
            ? `your overlay customizes ${e.relPath}, but that file no longer exists in the updated brain — review your overlay entry`
            : `your overlay customizes ${e.relPath}, and that file changed in this update — review your overlay entry against the new base`,
      });
      hashes[e.relPath] = now; // flag once per change; next update flags only new changes
    }
  }
  writeBaseHashes(t.overlayDir, hashes);

  return { before, after, fastForwarded: true, flagged };
}
