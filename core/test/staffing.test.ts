import assert from "node:assert/strict";
import { test } from "node:test";
import { companyOf, orderCatalog, parseRigConf, resolveSeat, resolveSeatDetailed, updateRigStaffing, versionRank } from "../src/staffing.js";
import type { Loadout } from "../src/manifest.js";

const loadout = {
  policy: { default_model: "openai-codex/gpt-5.5" },
} as Pick<Loadout, "policy">;

test("parseRigConf: quotes, comments, and multi-assignment ';' lines", () => {
  const conf = parseRigConf(
    [
      `# comment line`,
      `ORCH_AGENT="claude";     ORCH_MODEL="opus"`,
      `REVIEWER_AGENT="pi"; REVIEWER_MODEL="openai-codex/gpt-5.5"`,
      `TESTER_MODEL=''`,
      `export NMGATE_ENFORCE=1`,
      `DEV_URL="http://localhost:5173"   # trailing comment`,
    ].join("\n"),
  );
  assert.equal(conf.ORCH_AGENT, "claude");
  assert.equal(conf.ORCH_MODEL, "opus");
  assert.equal(conf.REVIEWER_AGENT, "pi");
  assert.equal(conf.TESTER_MODEL, "");
  assert.equal(conf.NMGATE_ENFORCE, "1");
  assert.equal(conf.DEV_URL, "http://localhost:5173");
});

test("precedence: loadout floor when nothing else speaks", () => {
  const s = resolveSeat("reviewer", loadout, {});
  assert.deepEqual(s, { agent: "pi", model: "openai-codex/gpt-5.5" });
});

test("precedence: user defaults beat the loadout floor", () => {
  const s = resolveSeat("reviewer", loadout, {
    userDefaults: { seats: { reviewer: { model: "anthropic/claude-sonnet-5" } } },
  });
  assert.equal(s.model, "anthropic/claude-sonnet-5");
});

test("precedence: rig.conf beats user defaults", () => {
  const s = resolveSeat("reviewer", loadout, {
    userDefaults: { seats: { reviewer: { model: "anthropic/claude-sonnet-5" } } },
    rigConf: { REVIEWER_MODEL: "openai-codex/gpt-5.4", REVIEWER_AGENT: "pi" },
  });
  assert.deepEqual(s, { agent: "pi", model: "openai-codex/gpt-5.4" });
});

test("rig.conf EMPTY model is honored as 'let /login pick' (existence beats emptiness)", () => {
  const s = resolveSeat("reviewer", loadout, { rigConf: { REVIEWER_MODEL: "" } });
  assert.equal(s.model, "");
});

test("seat prefix mapping: tester reads TESTER_*", () => {
  const s = resolveSeat("tester", loadout, { rigConf: { TESTER_AGENT: "claude", TESTER_MODEL: "opus" } });
  assert.deepEqual(s, { agent: "claude", model: "opus" });
});

// ── P4-1 provenance: print discloses where each value came from ─────────────

test("provenance: floor-only resolution labels loadout floor + built-in agent", () => {
  const d = resolveSeatDetailed("reviewer", loadout, {});
  assert.deepEqual(d.agent, { value: "pi", source: "built-in" });
  assert.deepEqual(d.model, { value: "openai-codex/gpt-5.5", source: "loadout floor" });
});

test("provenance: mixed sources on one seat (agent from rig.conf, model from user default)", () => {
  const d = resolveSeatDetailed("reviewer", loadout, {
    rigConf: { REVIEWER_AGENT: "claude" },
    userDefaults: { seats: { reviewer: { model: "opus" } } },
  });
  assert.deepEqual(d.agent, { value: "claude", source: "rig.conf" });
  assert.deepEqual(d.model, { value: "opus", source: "user default" });
});

test("provenance: empty rig.conf model is rig.conf-sourced (existence beats emptiness)", () => {
  const d = resolveSeatDetailed("reviewer", loadout, { rigConf: { REVIEWER_MODEL: "" } });
  assert.deepEqual(d.model, { value: "", source: "rig.conf" });
});

test("provenance: no loadout + nothing else = built-in empty model", () => {
  const d = resolveSeatDetailed("coder", undefined, {});
  assert.deepEqual(d.model, { value: "", source: "built-in" });
});

test("user defaults: prefs block validates (preview_provider + brand)", async () => {
  const { writeFileSync, mkdirSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadUserDefaults } = await import("../src/staffing.js");
  const home = mkdtempSync(join(tmpdir(), "crate2-defaults-"));
  mkdirSync(join(home, ".crate"), { recursive: true });
  writeFileSync(
    join(home, ".crate", "defaults.yaml"),
    'seats:\n  reviewer: { agent: pi }\nprefs:\n  preview_provider: tailscale\n  brand: { name: "My Shop" }\n',
  );
  const ud = loadUserDefaults(home);
  assert.equal(ud?.prefs?.preview_provider, "tailscale");
  assert.equal(ud?.prefs?.brand?.name, "My Shop");
});

// ── restaff-on-the-fly (cockpit, 2026-08-10) ──
test("updateRigStaffing replaces a seat's lines in place, comments survive", () => {
  const text = [
    `# staffing`,
    `ORCH_AGENT="claude";     ORCH_MODEL="opus"`,
    `CODER_AGENT="claude";    CODER_MODEL="opus"    # note kept? no — line replaced`,
    `PROJECT_NAME="x"`,
  ].join("\n");
  const out = updateRigStaffing(text, "coder", "pi", "openai-codex/gpt-5.5");
  assert.match(out, /CODER_AGENT="pi"; CODER_MODEL="openai-codex\/gpt-5.5"/);
  assert.doesNotMatch(out, /CODER_AGENT="claude"/);
  assert.match(out, /ORCH_AGENT="claude"/, "other seats untouched");
  assert.match(out, /PROJECT_NAME="x"/, "non-staffing lines untouched");
  assert.equal(parseRigConf(out)["CODER_AGENT"], "pi", "round-trips through the parser");
});

test("updateRigStaffing: orchestrator uses the ORCH prefix; values sanitized; empty model ok", () => {
  const out = updateRigStaffing("", "orchestrator", 'claude"; rm -rf /', "");
  assert.match(out, /^ORCH_AGENT="clauderm-rf\/"; ORCH_MODEL=""\n$/m, "quotes/spaces/semicolons stripped");
  assert.equal(parseRigConf(out)["ORCH_AGENT"], "clauderm-rf/");
});

// ── company grouping (cockpit picker, 2026-08-11) ──
test("companyOf: labs resolve from agent + model id; claude beats gpt-substring traps", () => {
  assert.equal(companyOf("claude", "fable"), "Anthropic");
  assert.equal(companyOf("codex", ""), "OpenAI");
  assert.equal(companyOf("pi", "openai-codex/gpt-5.5"), "OpenAI");
  assert.equal(companyOf("pi", "anthropic/claude-opus-4-8"), "Anthropic");
  assert.equal(companyOf("pi", "zenmux/moonshotai/kimi-k3"), "Moonshot AI");
  assert.equal(companyOf("pi", "zenmux/z-ai/glm-5.2"), "Z.ai");
  assert.equal(companyOf("pi", "zenmux/minimax/minimax-m3"), "MiniMax");
  assert.equal(companyOf("pi", "zenmux/qwen/qwen3.8-max"), "Alibaba (Qwen)");
  assert.equal(companyOf("pi", "deepseek/deepseek-v4-pro"), "DeepSeek");
});

test("orderCatalog: company blocks in lab order; curated hand-order first; discovered newest-first", () => {
  const out = orderCatalog([
    { agent: "pi", model: "openai-codex/gpt-5.5", display: "GPT-5.5 (Pi)" },
    { agent: "claude", model: "fable", display: "Fable" },
    { agent: "claude", model: "opus", display: "Opus" },
    { agent: "pi", model: "anthropic/claude-opus-4-5", display: "Opus 4.5", discovered: true as const },
    { agent: "pi", model: "anthropic/claude-opus-4-8", display: "Opus 4.8", discovered: true as const },
    { agent: "pi", model: "zenmux/z-ai/glm-5.2", display: "GLM-5.2", discovered: true as const },
  ]);
  assert.deepEqual(out.map((m) => m.display), ["Fable", "Opus", "Opus 4.8", "Opus 4.5", "GPT-5.5 (Pi)", "GLM-5.2"],
    "Anthropic block first (curated order, then discovered 4.8 > 4.5), then OpenAI, then Z.ai");
  assert.equal(out[0]!.company, "Anthropic");
});

test("versionRank: dashed versions normalize; context sizes never count", () => {
  assert.ok(versionRank("anthropic/claude-opus-4-8", "") > versionRank("anthropic/claude-opus-4-5", ""));
  assert.equal(versionRank("some/model-262144", "big context"), 0);
});
