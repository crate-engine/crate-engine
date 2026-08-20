// CE-158 + CE-159 — the two "does not feel premium" findings from the E1
// re-run (2026-08-20), both from Adam driving the fresh account live.
//
// CE-158: the staffing picker read like a catalog — tier blurbs, harness
// parentheticals, fix paragraphs — where a control shows NAMES. "The model
// being dark or greyed out is enough info."
//
// CE-159: the in-page folder choreography let a real stranger nest
// Desktop/My-app/My-app/my-app out of one intention. Where the server runs on
// the operator's own Mac, the OS has the premium answer: a real Save panel via
// osascript. Native where native is true; the in-page picker survives as the
// fallback because a native Mac dialog cannot browse a REMOTE host's disk.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { teamPage } from "../src/gui/teampage.js";

const PAGE = teamPage({ project: "pin-check", seats: [] });
const SERVER_SRC = readFileSync(new URL("../src/gui/server.js", import.meta.url).pathname.replace("/dist/", "/src/").replace(".js", ".ts"), "utf8");

// ── CE-158: names, not catalog copy ─────────────────────────────────────────

test("CE-158: picker rows render the stripped NAME, never the raw display string", () => {
  assert.match(PAGE, /name\(m\)/, "rows must go through name(), not esc(m.display)");
  assert.ok(!PAGE.includes("'+esc(m.display)+'"), "a raw display string in a row is the catalog voice coming back");
});

test("CE-158: the EMITTED name function actually strips — evaluated, not eyeballed", () => {
  // Adam's screenshot: rows showing ")" and "))". The first cut's regex sat in
  // the page TEMPLATE where backslash escapes cook away, so the client got a
  // regex that ATE the names. A needle test on the source shape passed the
  // whole time — only evaluating the function the page really ships catches
  // this class. (Third escape-cooking bite in two days; hence no regex at all.)
  const m = PAGE.match(/const name=m=>esc\(([^;]*)\);/);
  assert.ok(m, "name() not found in the emitted page");
  const fn = new Function("esc", "return m=>esc(" + m![1] + ")")((x: string) => x);
  assert.equal(fn({ display: "Claude Fable 5 (Claude Code) — Anthropic's top tier" }), "Claude Fable 5");
  assert.equal(fn({ display: "Claude Opus (Claude Code) — always the newest Opus (Opus 5 today)" }), "Claude Opus");
  assert.equal(fn({ display: "Antigravity CLI (Google — Gemini 3.x, Claude 4.6, GPT-OSS)" }), "Antigravity CLI");
  assert.equal(fn({ display: "GPT-5.5 (Pi)" }), "GPT-5.5");
  assert.equal(fn({ model: "deepseek/deepseek-v4-pro", display: "" }), "deepseek/deepseek-v4-pro");
});

test("CE-158: the bench is greyed names, full stop", () => {
  assert.ok(!PAGE.includes("not signed in':'not installed"), "state chips are explanations — greyed IS the information");
  assert.ok(!/pkrow[^>]*>.*a\.fix/.test(PAGE), "fix paragraphs do not belong in the picker");
  assert.match(PAGE, /opacity:\.45/, "the bench must still be VISIBLY greyed — dark is the one signal Adam kept");
});

test("CE-158: the verified badge survives — a badge is not prose", () => {
  assert.match(PAGE, /pktag">verified/);
});

test("CE-158: the guidance still lives where explaining IS the job", () => {
  // stripping the picker must not orphan the fix lines — the welcome modal
  // still renders them from /api/agents
  assert.match(PAGE, /Your rig needs a crew\./);
  assert.match(PAGE, /a\.fix/);
});

// ── CE-159: native where native is true ─────────────────────────────────────

test("CE-159: both doors TRY native first and keep the in-page fallback", () => {
  assert.match(PAGE, /nativePick\("create-project"/);
  assert.match(PAGE, /nativePick\("choose-folder"/);
  // cancel is a decision, not a fallback trigger — Cancel must NOT dump the
  // user into the in-page picker they were just spared
  assert.match(PAGE, /if\(nat&&nat\.cancelled\)return;/);
  assert.match(PAGE, /if\(n&&n\.cancelled\)return;/);
  // the fallback (the old picker) is still present for remote/Linux/headless
  assert.match(PAGE, /acPicker\("Choose your project folder/);
});

test("CE-159: the route is async — a save panel must never freeze the cockpit", () => {
  const route = SERVER_SRC.slice(SERVER_SRC.indexOf('case "POST /api/fs/native-pick"'), SERVER_SRC.indexOf('case "GET /api/fs/dirs"'));
  assert.ok(route.length > 100, "route not found");
  assert.match(route, /promisify\(execFile\)/, "sync exec here would freeze every poll loop while the human thinks");
  assert.ok(!/execFileSync/.test(route));
  assert.match(route, /timeout: 600_000/, "the human is thinking — never rush a save panel");
});

test("CE-159: cancel and unavailable are DIFFERENT answers", () => {
  // cancelled → the user said no, stop. unavailable → native cannot exist
  // here, fall back. Conflating them either nags a decliner or strands a
  // remote operator with no picker at all.
  const route = SERVER_SRC.slice(SERVER_SRC.indexOf('case "POST /api/fs/native-pick"'), SERVER_SRC.indexOf('case "GET /api/fs/dirs"'));
  assert.match(route, /cancelled: true/);
  assert.match(route, /unavailable: true/);
  assert.match(route, /canceled\|cancelled\|-128/);
});

test("CE-159: non-Mac servers answer unavailable before touching osascript", () => {
  const route = SERVER_SRC.slice(SERVER_SRC.indexOf('case "POST /api/fs/native-pick"'), SERVER_SRC.indexOf('case "GET /api/fs/dirs"'));
  assert.match(route, /process\.platform !== "darwin"/);
});

test("CE-159: the default name is sanitized before it rides into AppleScript", () => {
  // the defaultName lands inside a quoted AppleScript literal — strip anything
  // that could break out of it
  const route = SERVER_SRC.slice(SERVER_SRC.indexOf('case "POST /api/fs/native-pick"'), SERVER_SRC.indexOf('case "GET /api/fs/dirs"'));
  assert.match(route, /replace\(\/\[\^A-Za-z0-9\._ -\]\/g, ""\)/);
});
