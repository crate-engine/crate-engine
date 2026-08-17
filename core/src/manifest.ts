// Loadout manifest: types + loader + validation (PLAN §2.2, schema per P0-9).
// Source of truth for the schema is HERE (zod); config/loadouts/schema.json is
// generated from it by scripts/gen-schema.ts (see adr-ts-scaffold.md).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const SEATS = ["orchestrator", "coder", "reviewer", "designer", "tester"] as const;
export type Seat = (typeof SEATS)[number];

const ExtensionSchema = z
  .object({
    source: z
      .string()
      .regex(
        /^(npm:|git:|https:\/\/|ssh:\/\/|\.\/|\/)/,
        'must start with "npm:", "git:", "https://", "ssh://", "./" or "/" (a pi install source)',
      ),
    kind: z.enum(["pi-extension", "mcp-adapter"]),
    scope: z.enum(["global", "project"]).default("project"),
    mcp_servers: z.array(z.string()).optional(),
  })
  .strict();

const CliDepSchema = z
  .object({
    name: z.string().min(1),
    check: z.string().min(1),
    install: z.string().optional(),
    heavy: z.boolean().default(false),
    /** Plain-words purpose, shown to the USER by the attach tooling box —
     * "what your <seat> seat uses this for" (run #7 clarity pass). */
    why: z.string().optional(),
  })
  .strict();

const PolicySchema = z
  .object({
    tools: z
      .string()
      .regex(/^[a-z_]+(,[a-z_]+)*$/, 'comma-separated tool names, e.g. "read,bash"'),
    thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("medium"),
    default_model: z.string(),
    sandbox: z.enum(["readonly", "standard", "none"]),
    network: z.boolean().default(true),
    sandbox_doors: z.array(z.string()).default([]),
    // P4-12: the permission posture is a first-class, validated loadout field
    // (was a launcher special-case for claude-code). Coupled to the sandbox:
    // "bypassPermissions" is legal ONLY behind a wall — enforced right here at
    // the schema gate, and again at runtime in the launcher (belt-and-suspenders).
    permission_mode: z.enum(["default", "bypassPermissions"]).default("default"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.permission_mode === "bypassPermissions" && p.sandbox === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permission_mode"],
        message:
          'permission_mode "bypassPermissions" requires a sandbox wall (sandbox: readonly|standard) — ' +
          "a bypass seat without a wall is impossible by construction (the P3 security invariant)",
      });
    }
  });

export const LoadoutSchema = z
  .object({
    seat: z.enum(SEATS),
    // Which harness fills this seat. "pi" = the manifest builds the full pi
    // invocation; "claude-code" = first-party Claude Code (own toolkit — the
    // manifest contributes what the WALL needs: sandbox policy/doors/deps;
    // the launch line comes from the v1 claude adapter). P3-8.
    agent: z.enum(["pi", "claude-code"]).default("pi"),
    binder: z.string().min(1),
    append_system: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    prompt_templates: z.array(z.string()).default([]),
    extensions: z.array(ExtensionSchema).default([]),
    cli_deps: z.array(CliDepSchema).default([]),
    policy: PolicySchema,
  })
  .strict();

export type Loadout = z.infer<typeof LoadoutSchema>;

export class ManifestError extends Error {}

function plainWords(file: string, error: z.ZodError): string {
  const lines = error.issues.map((i) => {
    const where = i.path.length ? i.path.join(".") : "(top level)";
    return `  ${where}: ${i.message}`;
  });
  return `${file} is not a valid loadout:\n${lines.join("\n")}`;
}

/** Path of a seat's manifest inside the brain. */
export function loadoutPath(brainRoot: string, seat: Seat): string {
  return join(brainRoot, "config", "loadouts", `${seat}.yaml`);
}

/**
 * Load + validate a seat's loadout manifest from the brain.
 * Every failure is a ManifestError whose message says what to fix, in plain words.
 */
export function loadLoadout(brainRoot: string, seat: Seat): Loadout {
  const file = loadoutPath(brainRoot, seat);
  if (!existsSync(file)) {
    throw new ManifestError(`no loadout manifest for seat "${seat}" (looked for ${file})`);
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ManifestError(`${file} is not valid YAML: ${e instanceof Error ? e.message : e}`);
  }

  const parsed = LoadoutSchema.safeParse(raw);
  if (!parsed.success) throw new ManifestError(plainWords(file, parsed.error));
  const loadout = parsed.data;

  if (loadout.seat !== seat) {
    throw new ManifestError(
      `${file}: seat is "${loadout.seat}" but the file is named ${seat}.yaml — they must match`,
    );
  }

  // Referenced brain files must exist — fail at load, not at launch.
  const mustExist: Array<[string, string]> = [
    ["binder", loadout.binder],
    ...loadout.append_system.map((f): [string, string] => ["append_system", f]),
    ...loadout.skills.map((f): [string, string] => ["skills", f]),
    ...loadout.prompt_templates.map((f): [string, string] => ["prompt_templates", f]),
    ...loadout.extensions
      .filter((e) => e.source.startsWith("./") || e.source.startsWith("/"))
      .map((e): [string, string] => ["extensions", e.source]),
  ];
  for (const [field, rel] of mustExist) {
    const abs = resolve(brainRoot, rel);
    if (!existsSync(abs)) {
      throw new ManifestError(
        `${file}: ${field} points at a file that doesn't exist: ${rel} (resolved to ${abs})`,
      );
    }
  }

  return loadout;
}

// ── CE-117: project-owned ADDITIVE sandbox doors (Adam's ruling 2026-08-17) ──
// `.agents/config` is a symlink into the shared engine, so before this the ONLY
// way to give one project's coder a write door was to edit the shared loadout —
// which opened that door for EVERY rig on the host, with no record of which
// project asked. `.agents/doors.yaml` is that record: a repo-tracked, per-seat
// declaration MERGED AFTER the loadout's list. Additive-only by construction —
// a project can widen its own wall, never narrow one it did not write — and
// every render PRINTS the project doors, because a silent widening is the
// failure mode that matters here.

const ProjectDoorsSchema = z
  .object({ doors: z.record(z.string(), z.array(z.string())).default({}) })
  .strict();

export function projectDoorsPath(projectRoot: string): string {
  return join(projectRoot, ".agents", "doors.yaml");
}

/**
 * The project's own additive doors for one seat: `doors.all` plus
 * `doors.<seat>` from `<project>/.agents/doors.yaml`. Absent file → none.
 * A malformed file is a LOUD ManifestError — a silently ignored typo would
 * strand a seat behind a wall the operator believes they opened.
 */
export function loadProjectDoors(projectRoot: string, seat: Seat): string[] {
  const file = projectDoorsPath(projectRoot);
  if (!existsSync(file)) return [];

  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ManifestError(`${file} is not valid YAML: ${e instanceof Error ? e.message : e}`);
  }
  const parsed = ProjectDoorsSchema.safeParse(raw);
  if (!parsed.success) throw new ManifestError(plainWords(file, parsed.error));

  const valid = new Set<string>([...SEATS, "all"]);
  for (const k of Object.keys(parsed.data.doors)) {
    if (!valid.has(k)) {
      throw new ManifestError(
        `${file}: unknown seat "${k}" — seats are ${SEATS.join(", ")}, plus "all" for every seat`,
      );
    }
  }
  return [...(parsed.data.doors["all"] ?? []), ...(parsed.data.doors[seat] ?? [])];
}
