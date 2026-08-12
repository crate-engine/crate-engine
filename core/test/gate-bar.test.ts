// The masthead gate bar (flaw 2026-08-12): the all-blended cockpit rendered
// the orchestrator tile as a pure terminal — no chat box, so the operator's
// "merge go" had NO surface that carried their identity; the seat correctly
// refused the relay and the operator was reduced to running agentctl by hand
// mid-gate. The release surface must exist in EVERY layout, independent of
// which seats are blended. Client logic is JS inside the teampage template →
// structural assertions (the loopchip precedent).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("the gate bar ships as static chrome OUTSIDE the repainted grid", () => {
  const bar = html.indexOf('id="gatebar"');
  const grid = html.indexOf('id="grid"');
  assert.ok(bar >= 0, "gate bar element present");
  assert.ok(grid >= 0, "grid present");
  assert.ok(bar < grid, "bar sits before the grid — the 2s innerHTML repaint can never clobber it");
});

test("the bar renders from the poll and releases through the one shared route", () => {
  assert.ok(html.includes("renderGateBar()"), "refresh drives the bar");
  assert.ok(html.includes("function releaseFromBar"), "release handler present");
  const fn = html.slice(html.indexOf("function releaseFromBar"));
  assert.ok(fn.includes("/api/gates/release"), "bar releases via the same endpoint every surface shares");
});

test("a hidden bar actually hides — explicit display must not beat the hidden attribute", () => {
  // Adam's catch (2026-08-12): #gatebar{display:flex} overrode the HTML
  // `hidden` attribute, so the ticket-#3 "released" message fossilized on
  // screen 3.5h after DEPLOYED. The [hidden] rule is load-bearing.
  assert.ok(html.includes("#gatebar[hidden]{display:none}"), "the [hidden] display rule ships");
});

test("the bar is wired once at boot and takes the phrase on Enter", () => {
  assert.ok(html.includes('getElementById("gbinput")'), "input wired");
  assert.ok(/gbinput.*Enter.*releaseFromBar|Enter.*releaseFromBar/s.test(html), "Enter submits the phrase");
  assert.ok(html.includes('placeholder=\'type "merge go" to release\''), "the bar teaches the phrase in place");
});

test("the blended orchestrator tile still has no chat box — the bar is the surface", () => {
  // The tile branch for a live TTY returns a terminal head+host only; the gate
  // bar existing in static chrome is what makes that safe. If someone re-adds
  // a chat box per-tile, fine — but the bar must not silently disappear.
  assert.ok(html.includes('id="gbwhat"'), "bar label present");
  assert.ok(html.includes("merge gate holding"), "holding copy present");
});
