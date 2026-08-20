// CE-157 — the stranger's cliff: a fresh account's first project landed on five
// unstaffable seats with NO call to action.
//
// Found by the CE-034/E1 fresh-account run (2026-08-19): a genuinely fresh
// macOS user, the public one-liner, "do only what the app tells you." Install
// and project creation were flawless — then the operator stopped at five empty
// seats: "Done, clean, but not sure what to do next." The product HAD the
// answer the whole time (/api/agents carried per-agent fix lines) and never
// volunteered it.
//
// The cure is a MOMENT, not a document: a welcome modal on the create redirect
// (the one instant the stranger's full attention is on us), in two variants —
// "Your rig needs a crew." when no agent is ready, "Your rig is built." when
// staffing is one click away — plus a slim reopen-strip that survives a
// dismissed modal, and a zero-words pointer (the staff doors pulse on close).
//
// The COPY here is Adam-approved law (iterated line by line, 2026-08-19), so
// it is pinned VERBATIM: a helpful rewording is a regression.
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const PAGE = teamPage({ project: "pin-check", seats: [] });

test("Variant A copy — Adam's words, verbatim", () => {
  assert.match(PAGE, /Your rig needs a crew\./);
  assert.match(PAGE, /Seats run on your own AI agents\. This machine has none yet\./);
  assert.match(PAGE, /Install an agent on this machine — Claude Code, Codex, Pi/);
  assert.match(PAGE, /Crate detects your agents when they’re signed in/);
  assert.match(PAGE, /Back in Crate, click a seat to staff it/);
  assert.match(PAGE, />Got it</);
});

test("Variant B copy — Adam's words, verbatim", () => {
  assert.match(PAGE, /Your rig is built\./);
  assert.match(PAGE, /Click a seat to staff it — your agents are listed there/);
  assert.match(PAGE, /Tell the Orchestrator what to build/);
  assert.match(PAGE, /Let’s go/);
});

test("the variant is chosen by LIVE detection, not a stored flag", () => {
  // ready = any agent ready, asked at open time — a modal that guessed from a
  // flag written at install time would lie the morning after a sign-in.
  assert.match(PAGE, /const ag=await agentsInfo\(\)/);
  assert.match(PAGE, /ag\.some\(a=>a\.ready\)/);
});

test("one-source law: agent rows render /api/agents fix lines, never their own copy", () => {
  // The modal must not carry a second copy of install guidance (the CE-154
  // two-copies trap). It strips the fix line's redundant lead-in and shows the
  // actionable tail — but the words come from the server.
  assert.match(PAGE, /api\("\/api\/agents"\)/);
  assert.match(PAGE, /a\.fix/);
  assert.ok(!/npm install|npm i -g/.test(PAGE), "hardcoded install commands in the page = a second copy that will drift");
});

test("the modal notices a sign-in by itself while open", () => {
  // The promise step 2 makes ("Crate detects your agents when they're signed
  // in") is kept by the modal itself: it re-polls while open so the row flips
  // green without a Refresh hunt.
  assert.match(PAGE, /setInterval\(async\(\)=>\{await agentsInfo\(\)/);
});

test("welcome=1 rides the attach redirect, and is consumed so reloads don't re-fire", () => {
  assert.match(PAGE, /encodeURIComponent\(r\.project\)\+"&welcome=1"/);
  assert.match(PAGE, /searchParams\.delete\("welcome"\)/);
});

test("the quiet echo: the strip exists only while no agent is ready AND nothing ever ran", () => {
  // A dismissed modal plus a night's sleep is the cliff again — the strip is
  // the persistent way back. It must also RETIRE by itself: once any agent is
  // ready or any seat has run, it is noise.
  assert.match(PAGE, /No agents on this machine yet — setup steps/);
  assert.match(PAGE, /ag\.length>0&&!ag\.some\(a=>a\.ready\)&&!\(SEATSVIEW\|\|\[\]\)\.some\(s=>!seatUnstaffed\(s\)\)/);
});

test("the zero-words pointer: staff doors pulse on dismiss", () => {
  assert.match(PAGE, /staffpulse/);
  assert.match(PAGE, /querySelectorAll\("\.staffdoor"\)/);
});
