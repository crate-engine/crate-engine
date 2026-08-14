// Quiet cockpit, STAGE 2 (PDR quiet-cockpit; Adam's go 2026-08-14):
// EVENT-PRIMARY. Laws under test: the hub watches project STATE (seat
// files, events.log, chat mirror, maildirs) and emits ONE coalesced poke
// per burst; turn-file activity streams as its own events, never as pokes;
// TurnEvent.raw is STRIPPED from the wire (narrateLine keeps it — the view
// drops it: nothing renders it and it multiplied the poll payload); the
// page rides pokes through a ≥2s trailing throttle and demotes the poll to
// a 12s floor (SSE down → primary again at 2s, the deadbar's reflexes).
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hubFor, resetHubs, type TailEvent } from "../src/gui/turntail.js";
import { readTeamView } from "../src/gui/teamview.js";
import { teamPage } from "../src/gui/teampage.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-stage2-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeProj(name: string): string {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state"), { recursive: true });
  return proj;
}

test("a STATE write pokes — one coalesced poke per burst; a TURN write streams, never pokes", async () => {
  const proj = makeProj("poke");
  const hub = hubFor(proj, 100);
  const got: TailEvent[] = [];
  const unsub = hub.subscribe((ev) => got.push(ev));
  try {
    // Settle, then BASELINE. macOS FSEvents may replay events from just
    // before the watcher armed (the fixture's own mkdirs) as one stray
    // boot poke — harmless in the product (one extra refresh at connect,
    // which happens anyway), so the law under test starts AFTER settling.
    await sleep(700);
    const base = got.filter((e) => e.k === "poke").length;
    assert.ok(base <= 1, "boot is at most ONE stray FSEvents replay, never a stream of pokes");
    // a burst of state writes (a close touches several files) → ONE poke
    writeFileSync(join(proj, ".agents", "state", "orchestrator.md"), "Status: planning\n");
    appendFileSync(join(proj, ".agents", "state", "events.log"), "[t] START_IMPL actor=x state=implementing\n");
    writeFileSync(join(proj, ".agents", "state", "inbox", "coder", "new", "m1"), "mail\n");
    await sleep(900);
    assert.equal(got.filter((e) => e.k === "poke").length, base + 1, "a burst coalesces into exactly ONE poke");
    // turn-file activity is already its own stream — it must NOT poke
    const before = got.filter((e) => e.k === "poke").length;
    appendFileSync(
      join(proj, ".agents", "state", "turns", "coder", "2026-08-14T10-00-00.jsonl"),
      '{"type":"text_end","content":"hello"}\n',
    );
    await sleep(900);
    assert.equal(got.filter((e) => e.k === "poke").length, before, "turn lines stream as events, never as pokes");
    assert.ok(got.some((e) => e.seat === "coder" && e.k !== "poke"), "…and the turn line DID stream");
  } finally {
    unsub();
    resetHubs();
  }
});

test("the wire sheds raw: readTeamView events carry narration, never the original JSONL line", () => {
  const proj = makeProj("raw");
  const dir = join(proj, ".agents", "state", "turns", "coder");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "2026-08-14T10-00-00.jsonl"),
    '{"type":"result","subtype":"success","result":"APPROVED","session_id":"x"}\n',
  );
  const view = readTeamView(proj);
  const coder = view.seats.find((s) => s.seat === "coder")!;
  assert.ok(coder.turns.length >= 1, "the turn is in the view");
  for (const t of coder.turns) {
    for (const e of t.events) {
      assert.ok(e.narrated, "narration rides");
      assert.equal(e.raw, undefined, "raw never rides the view — nothing renders it");
    }
  }
});

// ── the page (structural pins, the gate-bar precedent) ──
const html = teamPage({ project: "demo", seats: [] });

test("the stream DRIVES: pokes and turn events schedule a throttled refresh", () => {
  assert.ok(html.includes('if(d.k==="poke"){pokeRefresh();return;}'), "a poke refreshes — before the backlog branch");
  assert.ok(html.indexOf('d.k==="poke"') < html.indexOf("d.backlog"), "poke handled first (it has no seat, no payload)");
  assert.ok(html.includes("function pokeRefresh"), "the trailing throttle exists");
  assert.ok(html.includes("pushItem(d);paintFeed(d.seat);") && /paintFeed\(d\.seat\);\s*pokeRefresh\(\);/.test(html), "turn activity nudges the throttle too — gauges stay fresh while a turn runs");
});

test("the poll is a FLOOR now: 12s reconciliation when the stream is live, 2s primary when it is not", () => {
  assert.ok(html.includes("function pollTick"), "the floor tick exists");
  assert.ok(html.includes("SSELIVE&&Date.now()-LASTREFRESH<12000"), "12s floor, gated on the stream being live");
  assert.ok(html.includes("setInterval(pollTick,2000)"), "the 2s timer drives the floor…");
  assert.ok(!html.includes("setInterval(refresh,2000)"), "…and never refresh directly — the bulldozer's clock is gone");
  assert.ok(html.includes("LASTREFRESH=Date.now()"), "only a SUCCESSFUL refresh stamps the floor — failures keep the 2s retry (deadbar honesty)");
});
