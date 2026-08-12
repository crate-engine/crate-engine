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

// The masthead chip itself is GONE (Adam, 2026-08-12): it narrated the loop
// for the wheels era; blended panes made it noise — the orchestrator's live
// session IS the narration. loopNarration (above) stays as the /api/loop
// server logic for programmatic callers. The masthead keeps only the LIVE
// project label, the dead-seat distress chip, and the gate bar; the
// NARRATED/ENGINEER lens toggle left with it (lenses styled the summarized
// feeds the blend replaced — ?lens=engineer stays as the URL escape hatch).
test("cockpit masthead is stripped: no loop chip, no lens toggle — the live surfaces remain", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(!html.includes('id="loopchip"'), "loop chip element removed");
  assert.ok(!html.includes("renderLoopChip"), "chip renderer removed");
  assert.ok(!html.includes('id="bn"') && !html.includes(">Narrated<"), "lens toggle removed");
  assert.ok(html.includes('id="projlabel"'), "live project label stays");
  assert.ok(html.includes('id="downchip"'), "dead-seat distress chip stays (safety)");
  assert.ok(html.includes('id="gatebar"'), "gate bar stays (the operator's release surface)");
});
