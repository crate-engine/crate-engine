// P3-0: the Seatbelt profile generator — manifest policy + project path → a
// rendered .sb profile (P0-6 proven shape: allow-default + write-wall + named
// doors). This is the ONLY Seatbelt-aware module: everything else consumes a
// rendered profile path, so the backend stays swappable (P0-6 note 4).
// Profiles land in the launch runtime dir, never committed.
// PHASE-8 T6: the swap happened — the same SandboxSpec renders to a bubblewrap
// argv on Linux (renderBwrapArgs) behind one dispatcher (renderWallPlan).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

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

export class SandboxError extends Error {}

/** Expand one door entry to an absolute path. */
export function expandDoor(door: string, paths: SandboxPaths): string {
  if (door === "~") return paths.home;
  if (door.startsWith("~/")) return join(paths.home, door.slice(2));
  if (isAbsolute(door)) return door;
  return join(paths.projectRoot, door);
}

/** Escape a literal path for embedding inside a Seatbelt regex filter. */
export function regexEscapePath(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
export function renderDoor(door: string, paths: SandboxPaths): string {
  if (door.startsWith("regex:")) {
    const pattern = door
      .slice("regex:".length)
      .replaceAll("{{PROJECT}}", regexEscapePath(paths.projectRoot))
      .replaceAll("{{HOME}}", regexEscapePath(paths.home))
      .replaceAll("{{PARENT}}", regexEscapePath(dirname(paths.projectRoot)));
    return `  (regex #"${pattern}")`;
  }
  return `  (subpath "${expandDoor(door, paths)}")`;
}

/**
 * Harness-state write doors per agent (P3-8): the templates carry pi's
 * `~/.pi` door inline; other harnesses declare theirs here and the launcher
 * merges them into the seat's doors. Claude Code writes its session/config
 * state under `~/.claude` plus the root-level json (+ its backup).
 */
export function stateDoorsFor(agent: string): string[] {
  if (agent === "claude-code") return ["~/.claude", "~/.claude.json", "~/.claude.json.backup"];
  if (agent === "codex") return ["~/.codex"]; // auth.json, config.toml, sessions, history
  return []; // pi: the templates already carry {{HOME}}/.pi
}

const DOORS_MARKER = /^.*\{\{DOORS\}\}.*$/m;

/**
 * Render a seat's profile text from the brain's template. Returns undefined
 * for `sandbox: none` (no wrap). Doors from the manifest expand at the
 * template's `{{DOORS}}` marker line; a doorless render strips the marker.
 */
export function renderProfile(spec: SandboxSpec, paths: SandboxPaths): string | undefined {
  if (spec.sandbox === "none") return undefined;

  const tplFile = join(paths.brainRoot, "config", "sandbox", `${spec.sandbox}.sb.tpl`);
  let text: string;
  try {
    text = readFileSync(tplFile, "utf8");
  } catch {
    throw new SandboxError(`no sandbox template for policy "${spec.sandbox}" (looked for ${tplFile})`);
  }
  if (!DOORS_MARKER.test(text)) {
    throw new SandboxError(`${tplFile} has no {{DOORS}} marker — template and generator are out of sync`);
  }

  const doorBlock =
    spec.doors.length === 0
      ? ""
      : [
          `; extra write doors from the ${spec.seat} manifest (policy.sandbox_doors)`,
          "(allow file-write*",
          ...spec.doors.map((d) => renderDoor(d, paths)),
          ")",
        ].join("\n");

  return text
    .replace(DOORS_MARKER, doorBlock)
    .replaceAll("{{PROJECT}}", paths.projectRoot)
    .replaceAll("{{HOME}}", paths.home)
    .replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// PHASE-8 T6 — the Linux backend: the SAME SandboxSpec renders to a bubblewrap
// argv instead of a .sb profile. Semantics mirror the Seatbelt templates:
// read-everything base + write-wall (--ro-bind / /), writable scratch, the
// harness's own state, then the policy zone (.agents/state for readonly, the
// whole project for standard) and the manifest doors. Door-granularity
// honestly differs (D7): bind mounts need concrete paths, so regex doors are
// un-expressible — they are SKIPPED and REPORTED, never silently dropped.
// ---------------------------------------------------------------------------

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
 * Missing-door type heuristic (consulted ONLY for a door that does not yet
 * exist — an existing door is stat-known). A basename with an extension after
 * its leading dots is treated as a FILE (`.claude.json`), else a DIR
 * (`.claude`, `.npm`, `.nmgate-wt`). Boundary: an extensionless missing FILE
 * door (e.g. `~/.netrc`) would be misread as a dir, and a dotted missing DIR
 * door (e.g. `foo-2.0/`) as a file — no shipped door hits either, and both
 * outcomes are non-destructive + reported (a mis-made dir is an empty
 * user-owned dir; a mis-skipped file surfaces in absentDoors). Prefer an
 * existing door when a rig cares about the distinction.
 */
function looksLikeFile(p: string): boolean {
  return basename(p).replace(/^\.+/, "").includes(".");
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
export function renderBwrapArgs(spec: SandboxSpec, paths: SandboxPaths): BwrapRender | undefined {
  if (spec.sandbox === "none") return undefined;

  const args: string[] = [
    "--ro-bind", "/", "/",
    "--dev", "/dev", // fresh minimal /dev: null/zero/tty/random — the template's tty/null allowance
    "--proc", "/proc", // fresh procfs; with --unshare-pid it lists only the sandbox
    // Isolate the sandbox from the host process table + SysV/POSIX IPC + host
    // names. NOT --unshare-net: network stays per-seat at the launcher layer
    // (network: true seats need loopback + the internet). Not a filesystem
    // control (the ro-bind base + userns already contain writes — verified
    // live: /proc/<pid>/root traversal is denied cross-userns), but it stops a
    // walled seat from SIGKILLing the supervisor or a peer seat mid-turn.
    "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup",
    "--bind-try", "/tmp", "/tmp", // runtime scratch (TMPDIR), the /private/tmp analog
    "--die-with-parent",
  ];

  const skippedDoors: string[] = [];
  const absentDoors: string[] = [];
  const bindWritable = (p: string): void => {
    if (!existsSync(p)) {
      if (looksLikeFile(p)) {
        args.push("--bind-try", p, p); // absent optional file: bind if it appears, never fail
        absentDoors.push(p);
        return;
      }
      mkdirSync(p, { recursive: true }); // a bind source must exist; a dir-door we own
    }
    args.push("--bind", p, p);
  };

  // The harness's own state (the templates carry {{HOME}}/.pi inline).
  bindWritable(join(paths.home, ".pi"));
  // The policy zone: readonly opens ONLY the seat's state dir; standard the project.
  if (spec.sandbox === "readonly") bindWritable(join(paths.projectRoot, ".agents", "state"));
  else bindWritable(paths.projectRoot);

  for (const door of spec.doors) {
    if (door.startsWith("regex:")) {
      skippedDoors.push(door); // no bind-mount equivalent — reported, not silent
      continue;
    }
    bindWritable(expandDoor(door, paths));
  }
  return { args, skippedDoors, absentDoors };
}

/** First `bwrap` on PATH, or undefined (D7: availability is a fail-loud cli_dep). */
export function findBwrap(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, "bwrap");
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

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
export function renderWallPlan(
  spec: SandboxSpec,
  paths: SandboxPaths,
  outDir: string,
  opts: { platform?: NodeJS.Platform; bwrapBin?: string } = {},
): WallPlan | undefined {
  if (spec.sandbox === "none") return undefined;
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") {
    const profile = writeProfile(spec, paths, outDir)!;
    return { backend: "seatbelt", argvPrefix: ["sandbox-exec", "-f", profile], skippedDoors: [], absentDoors: [] };
  }
  if (platform === "linux") {
    const bwrap = "bwrapBin" in opts ? opts.bwrapBin : findBwrap();
    if (!bwrap) {
      throw new SandboxError(
        `the ${spec.seat} seat's wall needs bubblewrap and it is not installed — install it: sudo apt install bubblewrap`,
      );
    }
    const r = renderBwrapArgs(spec, paths)!;
    return { backend: "bwrap", argvPrefix: [bwrap, ...r.args], skippedDoors: r.skippedDoors, absentDoors: r.absentDoors };
  }
  throw new SandboxError(
    `no sandbox backend for platform "${platform}" — walls render on macOS (Seatbelt) and Linux (bubblewrap)`,
  );
}

/** Narrow a full loadout to the generator's input. */
export function specFromLoadout(loadout: {
  seat: string;
  policy: { sandbox: SandboxPolicy; sandbox_doors: string[] };
}): SandboxSpec {
  return { seat: loadout.seat, sandbox: loadout.policy.sandbox, doors: loadout.policy.sandbox_doors };
}

/**
 * Render + write `<outDir>/<seat>.sb`; returns the profile path, or undefined
 * for `sandbox: none`.
 */
export function writeProfile(
  spec: SandboxSpec,
  paths: SandboxPaths,
  outDir: string,
): string | undefined {
  const rendered = renderProfile(spec, paths);
  if (rendered === undefined) return undefined;
  const file = join(outDir, `${spec.seat}.sb`);
  writeFileSync(file, rendered);
  return file;
}
