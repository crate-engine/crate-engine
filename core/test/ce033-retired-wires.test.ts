// CE-033 closed 2026-08-18 by RETIREMENT, not by proof (Adam's call).
//
// opencode and aider were wired 2026-07-14 and never earned a live authed turn
// in the month after; neither is installed on either machine. The catalog's job
// is to offer seats the engine can stand behind, and a "not yet battle-tested"
// label carried for a month is a promise nobody intends to keep — the CE-138
// family (copy the engine cannot back).
//
// The retirement is deliberately PARTIAL, and these tests pin both halves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { binaryFor } from "../src/detect.js";
import { buildHeadlessInvocation } from "../src/turn.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("the catalog no longer OFFERS opencode or aider", () => {
  const server = src("core/src/gui/server.ts");
  for (const agent of ["opencode", "aider"]) {
    assert.ok(
      !new RegExp(`agent: "${agent}"`).test(server),
      `${agent} is still offered on the staffing screen — retirement means the engine stops promising it`,
    );
  }
});

test("the agents the catalog DOES offer are all ones we can stand behind", () => {
  const server = src("core/src/gui/server.ts");
  const offered = [...server.matchAll(/^\s+agent: "([a-z]+)",$/gm)].map((m) => m[1]);
  const unique = [...new Set(offered)];
  // pi/claude/codex are battle-tested; agy is probe-qualified and labelled
  // not-yet-battle-tested with a live loop pending; gemini is honest about
  // needing an API key. Nothing else may appear without a deliberate edit here.
  assert.deepEqual(unique.sort(), ["agy", "claude", "codex", "gemini", "pi"]);
});

test("but the WIRES still run — a hand-edited rig.conf is never a dead seat", () => {
  // Fail-open doctrine. De-listing is about what the engine RECOMMENDS; it must
  // not strand an operator who deliberately staffs one of these by hand.
  for (const agent of ["opencode", "aider"]) {
    const { argv } = buildHeadlessInvocation(agent, { prompt: "do the thing" });
    assert.equal(argv[0], agent, `${agent}'s headless wire must still build`);
    assert.equal(binaryFor(agent), agent, `${agent} must still be install-detected`);
  }
});

test("both cards say RETIRED, why, and the way back in", () => {
  for (const agent of ["opencode", "aider"]) {
    const card = src(`adapters/${agent}/adapter.md`);
    assert.match(card, /RETIRED FROM THE CATALOG/, `${agent} card must state the decision`);
    assert.match(card, /Nothing was deleted/, "…and that the wire still works");
    assert.match(card, /blend-probe-recipe\.md/, "…and the concrete path back to first-class");
  }
});
