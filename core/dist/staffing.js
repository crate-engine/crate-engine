// Staffing resolution (PLAN §2.3): loadout default_model (floor) ← user tier
// ~/.crate/defaults.yaml (optional until Phase 4) ← project .agents/rig.conf.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
/** rig.conf uses v1's station prefixes; the seat ids are 2.0's. */
export const RIG_PREFIX = {
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
export function parseRigConf(text) {
    const out = {};
    for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
        if (!line)
            continue;
        for (const stmt of line.split(";")) {
            const m = stmt
                .trim()
                .match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(\S*))$/);
            if (m)
                out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
        }
    }
    return out;
}
const UserDefaultsSchema = z
    .object({
    seats: z
        .record(z.string(), z.object({ agent: z.string().optional(), model: z.string().optional() }).strict())
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
/** ~/.crate/defaults.yaml — optional until Phase 4 builds the user tier. */
export function loadUserDefaults(home) {
    const file = join(home, ".crate", "defaults.yaml");
    if (!existsSync(file))
        return undefined;
    const parsed = UserDefaultsSchema.safeParse(parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
        throw new Error(`${file} is not valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    return parsed.data;
}
/**
 * Precedence, most specific wins: rig.conf → user defaults → loadout floor.
 * A rig.conf key that EXISTS but is empty ("") is an explicit "let /login pick"
 * and is honored as-is — existence beats emptiness. Returns each value WITH
 * its source, so `crate2 print` can disclose where staffing came from.
 */
export function resolveSeatDetailed(seat, loadout, sources) {
    const prefix = RIG_PREFIX[seat];
    const rig = sources.rigConf ?? {};
    const ud = sources.userDefaults?.seats[seat];
    const agentKey = `${prefix}_AGENT`;
    const modelKey = `${prefix}_MODEL`;
    let agent;
    if (agentKey in rig && rig[agentKey] !== "")
        agent = { value: rig[agentKey], source: "rig.conf" };
    else if (ud?.agent !== undefined)
        agent = { value: ud.agent, source: "user default" };
    else
        agent = { value: "pi", source: "built-in" };
    let model;
    if (modelKey in rig)
        model = { value: rig[modelKey], source: "rig.conf" };
    else if (ud?.model !== undefined)
        model = { value: ud.model, source: "user default" };
    else if (loadout?.policy.default_model !== undefined)
        model = { value: loadout.policy.default_model, source: "loadout floor" };
    else
        model = { value: "", source: "built-in" };
    return { agent, model };
}
export function resolveSeat(seat, loadout, sources) {
    const d = resolveSeatDetailed(seat, loadout, sources);
    return { agent: d.agent.value, model: d.model.value };
}
//# sourceMappingURL=staffing.js.map