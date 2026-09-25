// Harness truth (Adam, 2026-09-25: "the new Opus 5.5 does not show up in the
// Crate models"). Crate staffs Claude by alias; the picker now names what the
// alias means on THIS computer's Claude Code, learned once per version, and the
// Computers menu flags a computer whose agent tool is behind another's.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  aliasCachePath, claudeAliasModels, claudeDisplay, compareVersions, forgetHarnessVersions, friendlyModel,
  harnessVersions, learnClaudeAliases, modelForAlias, parseVersion,
} from "../src/harness.js";
import { harnessBehind } from "../src/gui/fleet.js";
import { teamPage } from "../src/gui/teampage.js";

const scratch = mkdtempSync(join(tmpdir(), "harness-"));
const home = () => {
  const h = mkdtempSync(join(scratch, "home-"));
  mkdirSync(join(h, ".crate"), { recursive: true });
  return h;
};

test("versions parse and compare numerically", () => {
  assert.equal(parseVersion("2.1.282 (Claude Code)"), "2.1.282");
  assert.equal(parseVersion("pi 0.87.1"), "0.87.1");
  assert.ok(compareVersions("2.1.270", "2.1.282") < 0);
  assert.ok(compareVersions("0.87.1", "0.85.1") > 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
});

test("model ids read like people say them", () => {
  assert.equal(friendlyModel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(friendlyModel("claude-opus-5"), "Opus 5");
  assert.equal(friendlyModel("claude-fable-5-1"), "Fable 5.1");
  assert.equal(friendlyModel("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(friendlyModel("something-else"), "something-else");
});

test("the answering model is the alias's family — never Claude Code's helper model", () => {
  // Superman's real answer on 2026-09-24 listed BOTH (Claude Code uses Haiku for side tasks)
  const r = { modelUsage: { "claude-haiku-4-5-20251001": {}, "claude-opus-5": {} } };
  assert.equal(modelForAlias("opus", r), "claude-opus-5");
  assert.equal(modelForAlias("fable", r), undefined);
});

test("aliases are learned ONCE per Claude Code version — and relearned when it updates", async () => {
  const h = home();
  const asked: string[] = [];
  const ask = async (alias: string) => {
    asked.push(alias);
    return { modelUsage: { [`claude-${alias}-5-5`]: {} } };
  };
  await learnClaudeAliases(h, "2.1.282", ask);
  assert.deepEqual(asked, ["fable", "opus", "sonnet", "haiku"], "four one-line questions");
  assert.equal(claudeAliasModels(h, "2.1.282").opus, "claude-opus-5-5");
  await learnClaudeAliases(h, "2.1.282", ask);
  assert.equal(asked.length, 4, "a known version never asks again");
  assert.deepEqual(claudeAliasModels(h, "2.1.300"), {}, "a newer Claude Code makes the old answers stale");
  await learnClaudeAliases(h, "2.1.300", ask);
  assert.equal(asked.length, 8, "…and is learned afresh");
  assert.ok(existsSync(aliasCachePath(h)));
});

test("a failed alias stays unnamed and never breaks the rest", async () => {
  const h = home();
  await learnClaudeAliases(h, "9.9.9", async (alias) => {
    if (alias === "fable") throw new Error("not on this plan");
    return { modelUsage: { [`claude-${alias}-5`]: {} } };
  });
  const m = claudeAliasModels(h, "9.9.9");
  assert.equal(m.fable, undefined);
  assert.equal(m.opus, "claude-opus-5");
});

test("the picker NAME carries the real model — evaluated through the page's own name function (CE-158)", () => {
  const page = teamPage({ project: "demo", seats: [] });
  const m = page.match(/const name=m=>esc\(([^;]*)\);/);
  assert.ok(m, "the page's name() is emitted");
  const name = new Function("esc", "return m=>esc(" + m![1] + ")")((x: string) => x);
  assert.equal(name({ display: claudeDisplay("opus", { opus: "claude-opus-5-5" }) }), "Claude Opus 5.5");
  assert.equal(name({ display: claudeDisplay("fable", { fable: "claude-fable-5-1" }, "Anthropic's top tier") }), "Claude Fable 5.1");
  assert.equal(name({ display: claudeDisplay("opus", {}) }), "Claude Opus", "unknown yet → the honest family name");
  assert.match(claudeDisplay("opus", {}), /the newest Opus your Claude Code knows/);
});

test("the Computers menu names a computer whose agent tool is behind — with the command to fix it", () => {
  const behind = harnessBehind([
    { host: "This Mac", harness: { claude: "2.1.282", pi: "0.87.1" } },
    { host: "superman", harness: { claude: "2.1.270", pi: "0.87.1" } },
  ]);
  assert.deepEqual(behind.get("superman"), ["Claude Code 2.1.270 is older than on This Mac (2.1.282) — update it there: claude update"]);
  assert.equal(behind.get("This Mac"), undefined, "the newest copy is never flagged");
  assert.equal(harnessBehind([{ host: "solo", harness: { claude: "1.0.0" } }]).size, 0, "one computer has nothing to compare");
});

test("harness versions come from each tool's own --version", () => {
  const bin = mkdtempSync(join(scratch, "bin-"));
  for (const [b, out] of [["claude", "2.1.282 (Claude Code)"], ["pi", "0.87.1"]] as const) {
    writeFileSync(join(bin, b), `#!/bin/sh\necho "${out}"\n`);
    chmodSync(join(bin, b), 0o755);
  }
  forgetHarnessVersions();
  assert.deepEqual(harnessVersions({ path: bin }), { claude: "2.1.282", pi: "0.87.1" });
  forgetHarnessVersions();
  void readFileSync;
});
