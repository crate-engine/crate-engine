import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { narrateLine, narratedDigest, readTeamView } from "../src/gui/teamview.js";

// PHASE-8 T2: the viewer's data layer. narrateLine turns ONE raw stream
// line into a narrated+raw+kind event; readTeamView assembles seats from
// real on-disk artifacts. Fixtures are verbatim T0/T1 capture shapes.

test("narrateLine: claude result → narrated ✓ + result kind + raw preserved", () => {
  const raw = `{"type":"result","subtype":"success","result":"APPROVED","session_id":"x"}`;
  const e = narrateLine(raw);
  assert.equal(e.kind, "result");
  assert.match(e.narrated, /✓ APPROVED/);
  assert.equal(e.raw, raw);
});

test("narrateLine: turnMeta → meta kind with duration + tokens", () => {
  const e = narrateLine(`{"turnMeta":true,"ok":true,"durationMs":32439,"usage":{"inputTokens":707,"outputTokens":166}}`);
  assert.equal(e.kind, "meta");
  assert.match(e.narrated, /complete/);
  assert.match(e.narrated, /707→166 tok/);
});

test("narrateLine: codex command item → tool kind; agent_message → text", () => {
  assert.equal(narrateLine(`{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}`).kind, "tool");
  const t = narrateLine(`{"type":"item.completed","item":{"type":"agent_message","text":"looks good"}}`);
  assert.equal(t.kind, "text");
  assert.match(t.narrated, /looks good/);
});

test("narrateLine: stderr line → stderr kind; garbage → other (never throws)", () => {
  assert.equal(narrateLine(`{"stderr":"boom"}`).kind, "stderr");
  assert.equal(narrateLine(`not json at all`).kind, "other");
});

test("narratedDigest: terse ticker — tool beats + the ONE conclusion (verdict kept), prose dropped", () => {
  const evs = [
    { kind: "system", narrated: "· session init", raw: "" },
    { kind: "text", narrated: "Let me read the file and think about it carefully.", raw: "" },
    { kind: "tool", narrated: "$ cat src/slugify.js", raw: "" },
    { kind: "text", narrated: "Reviewed src/slugify.js: [CHANGES_NEEDED] for first-space bug. Updated state.", raw: "" },
    { kind: "meta", narrated: "turn complete", raw: "" },
  ] as never[];
  const d = narratedDigest(evs);
  assert.deepEqual(d, ["$ cat src/slugify.js", "Reviewed src/slugify.js: [CHANGES_NEEDED] for first-space bug."]);
  // the chatty intermediate prose ("Let me read…") is gone; the verdict survives
  assert.ok(!d.some((l) => l.includes("carefully")));
});

test("narratedDigest: dedupes repeated beats, empty when nothing meaningful", () => {
  assert.deepEqual(narratedDigest([{ kind: "system", narrated: "x", raw: "" }] as never[]), []);
  const dup = narratedDigest([
    { kind: "tool", narrated: "$ npm test", raw: "" },
    { kind: "tool", narrated: "$ npm test", raw: "" },
  ] as never[]);
  assert.deepEqual(dup, ["$ npm test"]);
});

test("readTeamView: assembles seats, reads status from state files", () => {
  const proj = mkdtempSync(join(tmpdir(), "crate2-teamview-"));
  mkdirSync(join(proj, ".agents", "state", "turns", "reviewer"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), 'PROJECT="tv"\nREVIEWER_AGENT="pi"\n');
  writeFileSync(join(proj, ".agents", "state", "reviewer.md"), "# Reviewer State\n\nStatus: changes_needed\nNow: reviewed slugify\n");
  writeFileSync(
    join(proj, ".agents", "state", "turns", "reviewer", "2026-07-12T10-00-00.000Z.jsonl"),
    `{"type":"result","result":"CHANGES_NEEDED"}\n{"turnMeta":true,"ok":true,"durationMs":100,"usage":{"inputTokens":5,"outputTokens":2},"startedAt":"2026-07-12T10:00:00.000Z"}\n`,
  );
  const v = readTeamView(proj);
  assert.equal(v.project, "tv");
  assert.equal(v.seats.length, 5);
  const rev = v.seats.find((s) => s.seat === "reviewer")!;
  assert.equal(rev.agent, "pi");
  assert.equal(rev.status, "changes_needed");
  assert.equal(rev.turns.length, 1);
  assert.equal(rev.turns[0]!.ok, true);
  assert.equal(rev.turns[0]!.usage!.inputTokens, 5);
  // an untouched seat is present but empty (honest "idle" in the UI)
  assert.equal(v.seats.find((s) => s.seat === "designer")!.turns.length, 0);
});
