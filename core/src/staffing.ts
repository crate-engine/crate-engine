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

// ── Company grouping for the staffing pickers (Adam, 2026-08-11): group by
// lab, frontier-first within each group. Curated entries keep their hand
// order (already frontier-first per lab); discovered entries sort by a
// version rank extracted from the id ("4-8" reads as 4.8). ──

export function companyOf(agent: string, model: string): string {
  const s = model.toLowerCase();
  if (agent === "claude" || s.includes("claude") || s.startsWith("anthropic/")) return "Anthropic";
  if (agent === "gemini" || s.includes("gemini") || s.includes("google/")) return "Google";
  if (s.includes("deepseek")) return "DeepSeek";
  if (s.includes("kimi") || s.includes("moonshot")) return "Moonshot AI";
  if (s.includes("glm") || s.includes("z-ai/") || s.includes("zai/")) return "Z.ai";
  if (s.includes("minimax")) return "MiniMax";
  if (s.includes("qwen")) return "Alibaba (Qwen)";
  if (agent === "codex" || s.includes("gpt") || s.startsWith("openai")) return "OpenAI";
  return "Other";
}

const COMPANY_ORDER = ["Anthropic", "OpenAI", "Google", "DeepSeek", "Moonshot AI", "Z.ai", "MiniMax", "Alibaba (Qwen)", "Other"];

/** Version-desc rank for discovered entries; small numbers only (context
 * sizes and dates never count as versions). */
export function versionRank(model: string, display: string): number {
  const s = `${model} ${display}`.toLowerCase().replace(/(\d)-(\d)/g, "$1.$2");
  let v = 0;
  for (const m of s.matchAll(/\b(\d{1,2}(?:\.\d{1,2})?)\b/g)) {
    const n = parseFloat(m[1]!);
    if (n < 50 && n > v) v = n;
  }
  return v;
}

export interface CatalogEntryLike {
  agent: string;
  model: string;
  display: string;
  discovered?: boolean;
}

/** Stable-order the merged catalog: company blocks (fixed lab order), within
 * a block curated hand-order first, then discovered newest-version-first. */
export function orderCatalog<T extends CatalogEntryLike>(models: T[]): (T & { company: string })[] {
  const tagged = models.map((m, i) => ({ m, i, company: companyOf(m.agent, m.model) }));
  tagged.sort((a, b) => {
    const co = COMPANY_ORDER.indexOf(a.company) - COMPANY_ORDER.indexOf(b.company);
    if (co !== 0) return co;
    const disc = (a.m.discovered ? 1 : 0) - (b.m.discovered ? 1 : 0);
    if (disc !== 0) return disc;
    if (a.m.discovered) {
      const r = versionRank(b.m.model, b.m.display) - versionRank(a.m.model, a.m.display);
      if (r !== 0) return r;
    }
    return a.i - b.i;
  });
  return tagged.map((t) => ({ ...t.m, company: t.company }));
}
