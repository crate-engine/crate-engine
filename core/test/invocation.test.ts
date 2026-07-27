import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { loadLoadout } from "../src/manifest.js";
import { buildInvocation, toShellCommand } from "../src/invocation.js";

const BRAIN = join(import.meta.dirname, "fixtures", "brain");
const PROJECT = "/Users/example/Projects/selftest";
const paths = { brainRoot: BRAIN, projectRoot: PROJECT };

test("GOLDEN argv: the reviewer manifest reproduces the live-verified invocation", () => {
  const loadout = loadLoadout(BRAIN, "reviewer");
  const inv = buildInvocation(loadout, { agent: "pi", model: "openai-codex/gpt-5.5" }, paths);
  assert.deepEqual(inv.argv, [
    "pi",
    "--model", "openai-codex/gpt-5.5",
    "--tools", "read,bash",
    "--thinking", "high",
    "--approve",
    "--append-system-prompt", join(BRAIN, "config/reviewer.md"),
    "--no-skills",
    "--skill", join(BRAIN, "config/skills/test-skill.md"),
    "--no-prompt-templates",
    "--no-extensions",
    "--session-dir", join(PROJECT, ".agents/state/sessions/reviewer"),
  ]);
  assert.equal(inv.cwd, PROJECT);
});

test("staffing override swaps ONLY --model", () => {
  const loadout = loadLoadout(BRAIN, "reviewer");
  const a = buildInvocation(loadout, { agent: "pi", model: "openai-codex/gpt-5.5" }, paths);
  const b = buildInvocation(loadout, { agent: "pi", model: "deepseek/deepseek-v4-pro" }, paths);
  const [modelA, modelB] = [a.argv[a.argv.indexOf("--model") + 1], b.argv[b.argv.indexOf("--model") + 1]];
  assert.equal(modelA, "openai-codex/gpt-5.5");
  assert.equal(modelB, "deepseek/deepseek-v4-pro");
  const strip = (argv: string[]) => argv.filter((_, i) => i !== argv.indexOf("--model") + 1);
  assert.deepEqual(strip(a.argv), strip(b.argv));
});

test("empty model omits --model entirely (login picks)", () => {
  const loadout = loadLoadout(BRAIN, "reviewer");
  const inv = buildInvocation(loadout, { agent: "pi", model: "" }, paths);
  assert.ok(!inv.argv.includes("--model"));
});

test("a manifest skill adds exactly one --skill; discovery stays off", () => {
  const loadout = loadLoadout(BRAIN, "reviewer");
  const inv = buildInvocation(loadout, { agent: "pi", model: "x/y" }, paths);
  assert.equal(inv.argv.filter((a) => a === "--skill").length, 1);
  assert.ok(inv.argv.includes("--no-skills"));
  assert.ok(inv.argv.includes("--no-prompt-templates"));
});

test("--no-extensions present only when the manifest lists none", () => {
  const loadout = loadLoadout(BRAIN, "reviewer");
  assert.ok(buildInvocation(loadout, { agent: "pi", model: "" }, paths).argv.includes("--no-extensions"));
  const withExt = { ...loadout, extensions: [{ source: "npm:x", kind: "pi-extension" as const, scope: "project" as const }] };
  assert.ok(!buildInvocation(withExt, { agent: "pi", model: "" }, paths).argv.includes("--no-extensions"));
});

test("toShellCommand quotes only what needs quoting", () => {
  const cmd = toShellCommand({ argv: ["pi", "--append-system-prompt", "/a path/with space.md"], cwd: "/" });
  assert.equal(cmd, `pi --append-system-prompt '/a path/with space.md'`);
});
