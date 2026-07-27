import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRigConf, resolveSeat, resolveSeatDetailed } from "../src/staffing.js";
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
