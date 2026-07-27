// 2c-b — the orchestrator MERGED timeline (PDR live-seat-readout §2b,
// locked 2026-07-26). The pane logic is client JS inside the teampage
// template, so these are structural assertions (the loopchip precedent);
// ordering/interleave behavior is proven live (dev/plan/proofs/orch-pane/).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("2c-b: the merged-timeline machinery ships in the page", () => {
  assert.ok(html.includes("function orchFeedHtml"), "merged feed builder present");
  assert.ok(html.includes("function chatFeedLine"), "conversation-line renderer present");
  assert.ok(html.includes("function stampBacklogMs"), "backlog seam-anchor stamping present");
  assert.ok(html.includes('paintFeed'), "stream paints route through paintFeed");
  assert.ok(/fmsg op/.test(html) && /fmsg eng/.test(html) && /fmsg orch/.test(html), "all three conversation voices styled");
});

test("2c-b: the SSE-down fallback keeps the legacy chat view (never a blank pane)", () => {
  assert.ok(html.includes("chatLogHtml()"), "legacy chat renderer retained");
  assert.ok(html.includes("orchwork"), "last-action thinking line retained for fallback");
  assert.ok(html.includes("first-run greeting"), "empty state keeps the greeting");
});
