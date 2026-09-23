// CE-171 (re-install run 2026-09-13, Test-App-2): the orchestrator binder sends
// every orchestrator to "your adapter's orchestrator-ops card", but only
// adapters/claude/ shipped one — a pi orchestrator's FIRST boot read was
// ENOENT. DRIFT GUARD: every agent the staffing catalog marks verified for the
// orchestrator seat must carry the card, so the binder's promise can never
// again outrun the adapters. Reads the catalog SOURCE (the CE-148 pattern) —
// the catalog is a module-private constant in gui/server.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("../src/gui/server.ts", import.meta.url), "utf8");
const adapters = new URL("../../adapters/", import.meta.url);
const binder = readFileSync(new URL("../../config/orchestrator.md", import.meta.url), "utf8");

/** Agents whose catalog row lists "orchestrator" in verifiedFor. */
function orchestratorVerifiedAgents(): string[] {
  const block = src.slice(src.indexOf("const MODELS = ["), src.indexOf("];", src.indexOf("const MODELS = [")));
  const rows = block.split(/\n\s*\{\n/).slice(1);
  const agents = rows
    .filter((r) => /verifiedFor:\s*\[[^\]]*"orchestrator"/.test(r))
    .map((r) => /agent:\s*"([^"]+)"/.exec(r)?.[1])
    .filter((a): a is string => Boolean(a));
  return [...new Set(agents)];
}

test("the catalog parse finds the orchestrator-verified agents (guard is not vacuous)", () => {
  assert.ok(orchestratorVerifiedAgents().includes("pi"), "pi is catalog-verified for the orchestrator seat today");
});

test("every orchestrator-verified agent ships adapters/<agent>/orchestrator-ops.md", () => {
  for (const agent of orchestratorVerifiedAgents()) {
    assert.ok(existsSync(new URL(`${agent}/orchestrator-ops.md`, adapters)),
      `${agent} is verified for the orchestrator seat but has no orchestrator-ops card (CE-171)`);
  }
});

test("the harness-neutral base card exists and the binder names the fallback for card-less agents", () => {
  assert.ok(existsSync(new URL("claude/orchestrator-ops.md", adapters)));
  assert.match(binder, /any other agent uses\s*>?\s*`adapters\/claude\/orchestrator-ops\.md`/);
});

test("the pi card's dispatch line signs --from orchestrator (CE-185 refuses any other signature)", () => {
  const card = readFileSync(new URL("pi/orchestrator-ops.md", adapters), "utf8");
  assert.match(card, /deliver <seat> --from orchestrator/);
});
