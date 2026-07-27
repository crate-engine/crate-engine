// W0 (audit C2): the sign-in button ACTS. Pure-plan tests — no real windows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openSignInTerminal, terminalPlan } from "../src/gui/terminal.js";

test("darwin: the sign-in plan opens Terminal RUNNING the command (osascript do script)", () => {
  const p = terminalPlan("claude", "darwin");
  assert.equal(p.mode, "run");
  assert.equal(p.bin, "osascript");
  assert.match(p.args!.join(" "), /do script "claude"/);
  assert.match(p.note, /notices by itself/);
});

test("non-mac: an honest note, no spawn attempted", () => {
  const p = terminalPlan("pi", "linux");
  assert.equal(p.mode, "none");
  assert.equal(p.bin, undefined);
  const r = openSignInTerminal("pi", "linux");
  assert.equal(r.mode, "none");
  assert.match(r.note, /run `pi`/);
});
