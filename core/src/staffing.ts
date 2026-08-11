// Staffing resolution (PLAN §2.3): loadout default_model (floor) ← user tier
// ~/.crate/defaults.yaml (optional until Phase 4) ← project .agents/rig.conf.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Loadout, Seat } from "./manifest.js";

export interface Staffed {
  agent: string;
  /** "" means: let the interactive /login session pick (the pi adapter's rule). */
  model: string;
}

/** rig.conf uses v1's station prefixes; the seat ids are 2.0's. */
export const RIG_PREFIX: Record<Seat, string> = {
  orchestrator: "ORCH",
  coder: "CODER",
  reviewer: "REVIEWER",
  designer: "DESIGNER",
  tester: "TESTER",
};

/**
 * Parse shell-style KV assignments: `KEY="value"`, single quotes, bare values,
 * optional `export`, comments, and MULTIPLE assignments per line separated by
 * ";" (rig.conf.example writes `ORCH_AGENT="claude"; ORCH_MODEL="opus"`).
 */
export function parseRigConf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    for (const stmt of line.split(";")) {
      const m = stmt
        .trim()
        .match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(\S*))$/);
      if (m) out[m[1]!] = m[2] ?? m[3] ?? m[4] ?? "";
    }
  }
  return out;
}

const UserDefaultsSchema = z
  .object({
    seats: z
      .record(
        z.string(),
        z.object({ agent: z.string().optional(), model: z.string().optional() }).strict(),
      )
      .default({}),
    // P4-1: minimal prefs — only what Phase 4 consumes; no speculative keys.
    prefs: z
      .object({
        preview_provider: z.enum(["none", "tailscale", "custom"]).optional(),
        brand: z
          .object({
            name: z.string().optional(),
            accent: z.string().optional(),
            bg: z.string().optional(),
            fg: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UserDefaults = z.infer<typeof UserDefaultsSchema>;

/** ~/.crate/defaults.yaml — optional until Phase 4 builds the user tier. */
export function loadUserDefaults(home: string): UserDefaults | undefined {
  const file = join(home, ".crate", "defaults.yaml");
  if (!existsSync(file)) return undefined;
  const parsed = UserDefaultsSchema.safeParse(parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `${file} is not valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

/** Where a resolved staffing value came from (P4-1: provenance for `print`). */
export type StaffingSource = "rig.conf" | "user default" | "loadout floor" | "built-in";

export interface StaffedDetailed {
  agent: { value: string; source: StaffingSource };
  model: { value: string; source: StaffingSource };
}

/**
 * Precedence, most specific wins: rig.conf → user defaults → loadout floor.
 * A rig.conf key that EXISTS but is empty ("") is an explicit "let /login pick"
 * and is honored as-is — existence beats emptiness. Returns each value WITH
 * its source, so `crate2 print` can disclose where staffing came from.
 */
export function resolveSeatDetailed(
  seat: Seat,
  loadout: Pick<Loadout, "policy"> | undefined,
  sources: { rigConf?: Record<string, string>; userDefaults?: UserDefaults },
): StaffedDetailed {
  const prefix = RIG_PREFIX[seat];
  const rig = sources.rigConf ?? {};
  const ud = sources.userDefaults?.seats[seat];

  const agentKey = `${prefix}_AGENT`;
  const modelKey = `${prefix}_MODEL`;

  let agent: StaffedDetailed["agent"];
  if (agentKey in rig && rig[agentKey] !== "") agent = { value: rig[agentKey]!, source: "rig.conf" };
  else if (ud?.agent !== undefined) agent = { value: ud.agent, source: "user default" };
  else agent = { value: "pi", source: "built-in" };

  let model: StaffedDetailed["model"];
  if (modelKey in rig) model = { value: rig[modelKey]!, source: "rig.conf" };
  else if (ud?.model !== undefined) model = { value: ud.model, source: "user default" };
  else if (loadout?.policy.default_model !== undefined)
    model = { value: loadout.policy.default_model, source: "loadout floor" };
  else model = { value: "", source: "built-in" };

  return { agent, model };
}

export function resolveSeat(
  seat: Seat,
  loadout: Pick<Loadout, "policy"> | undefined,
  sources: { rigConf?: Record<string, string>; userDefaults?: UserDefaults },
): Staffed {
  const d = resolveSeatDetailed(seat, loadout, sources);
  return { agent: d.agent.value, model: d.model.value };
}

/**
 * Rewrite ONE seat's staffing in rig.conf text (the cockpit's restaff-on-
 * the-fly). Every uncommented <PREFIX>_AGENT/_MODEL line for the seat is
 * dropped and one canonical line appended; values are sanitized for the
 * shell-style file (rig.conf is parsed, never executed — but stay strict).
 */
export function updateRigStaffing(text: string, seat: Seat, agent: string, model: string): string {
  const prefix = RIG_PREFIX[seat];
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._/:-]/g, "");
  const re = new RegExp(`^\\s*${prefix}_(AGENT|MODEL)=`);
  const lines = text.split("\n").filter((l) => !re.test(l));
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  lines.push(`${prefix}_AGENT="${clean(agent)}"; ${prefix}_MODEL="${clean(model)}"`);
  return lines.join("\n") + "\n";
}
