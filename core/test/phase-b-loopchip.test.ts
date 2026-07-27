// PHASE-B #2 — the loop-narration chip: round N + whose move it is, derived
// from events.log. Fixture lines are the REAL testuser8 run (2026-07-13).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loopNarration } from "../src/gui/narration.js";
import { teamPage } from "../src/gui/teampage.js";

const RUN = [
  "[2026-07-13T15:38:59] BOOT actor=orchestrator state=initialized",
  "[2026-07-13T15:38:59] START_IMPL actor=orchestrator branch=feature/team-reliability-smoke-test state=implementing",
  "[2026-07-13T15:45:07] CODE_READY actor=coder branch=feature/team-reliability-smoke-test sha=337c36ac3 state=code_ready",
  "[2026-07-13T15:52:21] CHANGES_NEEDED actor=orchestrator reason=contrast fixes state=implementing",
  "[2026-07-13T15:55:40] CODE_READY actor=coder sha=edc6b2287 state=code_ready",
  "[2026-07-13T16:00:08] APPROVED actor=orchestrator state=approved",
];

test("narration walks the real testuser8 run round by round", () => {
  assert.equal(loopNarration([]), null, "no events → no chip (never invent a state)");
  assert.equal(loopNarration(RUN.slice(0, 1))?.text, "team booted — waiting for the first work order");
  assert.equal(loopNarration(RUN.slice(0, 2))?.text, "round 1 — the coder is building");
  assert.equal(loopNarration(RUN.slice(0, 3))?.text, "round 1 — review & QA are checking");
  assert.equal(loopNarration(RUN.slice(0, 4))?.text, "round 2 — rework round (normal: review asked for changes)");
  assert.equal(loopNarration(RUN.slice(0, 5))?.text, "round 2 — review & QA are checking");
  const done = loopNarration(RUN);
  assert.equal(done?.text, `approved — type "merge go" to ship`);
  assert.equal(done?.state, "approved");
  assert.equal(done?.at, "2026-07-13T16:00:08");
});

test("a new START_IMPL resets the round count (narrate the current run only)", () => {
  const next = [...RUN, "[2026-07-13T17:00:00] START_IMPL actor=orchestrator branch=feature/two state=implementing"];
  assert.equal(loopNarration(next)?.text, "round 1 — the coder is building");
});

test("cockpit masthead carries the loop chip wired to /api/loop", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(html.includes('id="loopchip"'), "chip element present");
  assert.ok(html.includes("renderLoopChip"), "renderer wired");
  assert.ok(html.includes("/api/loop"), "polls the loop endpoint");
});
