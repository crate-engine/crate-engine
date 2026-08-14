// Quiet cockpit, stage 1 (PDR quiet-cockpit; Adam's grill 2026-08-14): the
// chrome follows the two rules the panes always followed — draw only when
// something CHANGED, and only the region that changed. Laws under test:
// the whole-grid bulldozer survives ONLY behind the structure guard; tiles
// repaint per-region through dirty keys; the key excludes what never
// renders (events[].raw) and what patches in place (gauge, liveTokens);
// clean tiles get value writes only; every grid gesture parks the repaint;
// scroll pinning touches only repainted feeds. Structural assertions (the
// gate-bar precedent).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("the whole page script still PARSES after the surgery", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.ok(scripts.length >= 1);
  for (const s of scripts) new Function(s);
});

test("the bulldozer is caged: ONE whole-grid innerHTML write, and only behind the structure guard", () => {
  const writes = [...html.matchAll(/getElementById\("grid"\)\.innerHTML=/g)];
  assert.equal(writes.length, 1, "exactly one whole-grid rebuild path remains");
  const guard = html.indexOf('rkDirty("grid-struct"');
  assert.ok(guard >= 0, "the structure dirty-check exists");
  assert.ok(guard < writes[0]!.index!, "…and it sits BEFORE the rebuild — structure changes are the only whole-grid path");
  assert.ok(html.includes("if(structDirty){"), "the rebuild is inside the structure branch");
});

test("per-tile damage: dirty keys drive replaceWith, clean tiles keep their DOM identity", () => {
  assert.ok(html.includes("function rkDirty"), "the region dirty-check exists");
  assert.ok(html.includes("function tileKey"), "the tile key exists");
  assert.ok(html.includes('rkDirty("tile:"+seat'), "tiles are keyed per seat");
  assert.ok(html.includes("old.replaceWith(tpl.content.firstChild)"), "a dirty tile swaps in place — gutters and clean tiles are never touched");
});

test("the key excludes what must not repaint: raw never rides, feeds ride only when SSE is down, gauge/tokens patch in place", () => {
  const fn = html.slice(html.indexOf("function tileKey"), html.indexOf("function patchTileLive"));
  assert.ok(!fn.includes(".raw"), "events[].raw is never rendered, so it never dirties a tile");
  assert.ok(fn.includes("SSELIVE&&FEEDS"), "turn content keys the tile only when the poll is the feed painter");
  const patch = html.slice(html.indexOf("function patchTileLive"), html.indexOf("async function refresh"));
  assert.ok(patch.includes("g.className!==cls"), "gauge band writes only on change");
  assert.ok(patch.includes("gf.style.width!==w"), "gauge fill writes only on change");
  assert.ok(patch.includes("w2.dataset.tok"), "live token count patches in place (tickWorking reads it)");
});

test("EVERY grid gesture parks the repaint — selection, seam drag, header drag-swap (the previously unguarded member)", () => {
  assert.ok(/if\(SELDRAG\|\|GUTDRAG\|\|SWAP\|\|Date\.now\(\)-SELHOLD<5000\)return;/.test(html), "the gesture guard covers all three");
});

test("scroll pinning touches ONLY repainted feeds — an untouched feed keeps the user's scroll", () => {
  assert.ok(!html.includes('querySelectorAll(".feed")'), "the pin-everything sweep is gone");
  assert.ok(html.includes("pinned.forEach"), "pinning iterates the repainted set");
  assert.ok(html.includes('pinned.indexOf("orchestrator")'), "the chatlog pins only when the orchestrator tile repainted");
});

test("the preservation belts STAY (dormant) — their strings are the 'cure holds' pins", () => {
  // gate-bar.test.ts pins the gbinput belt; these pin the rest
  assert.ok(html.includes("const chatVal=cb?cb.value:\"\""), "chat typing capture kept");
  assert.ok(html.includes("TTYS[ttyFocusSeat].term.focus()"), "wheel focus handback kept");
  assert.ok(html.includes("Date.now()-SELHOLD<5000"), "selection hold kept");
});
