// 2026-07-14 seat expansion — opencode/aider/gemini wired as headless seats
// (flag surfaces verified against the shipping CLIs' --help the night they
// were wired), openclaw detected but deliberately NOT wired/offered. Every
// new option labels "not yet battle-tested"; these tests pin the shapes.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentLabel, binaryFor, seatAuthProblem } from "../src/detect.js";
import { buildHeadlessInvocation, parseSessionId } from "../src/turn.js";

test("opencode headless wire: run --format json; --auto ONLY walled; session resumes", () => {
  const un = buildHeadlessInvocation("opencode", { prompt: "do it", model: "anthropic/claude-opus-4-8" });
  assert.deepEqual(un.argv, ["opencode", "run", "--format", "json", "--model", "anthropic/claude-opus-4-8", "do it"]);
  const walled = buildHeadlessInvocation("opencode", { prompt: "do it", walled: true, sessionId: "ses_1" });
  assert.deepEqual(walled.argv, ["opencode", "run", "--format", "json", "--auto", "--session", "ses_1", "do it"]);
  assert.equal(un.stdin, "ignore");
});

test("aider headless wire: --message one-shot, --yes-always automation, stateless", () => {
  const inv = buildHeadlessInvocation("aider", { prompt: "fix the bug", model: "gpt-5.5" });
  assert.deepEqual(inv.argv, ["aider", "--message", "fix the bug", "--yes-always", "--no-stream", "--model", "gpt-5.5"]);
});

test("gemini headless wire: -p + stream-json; yolo ONLY walled; never gemini's own --sandbox", () => {
  const un = buildHeadlessInvocation("gemini", { prompt: "review it" });
  assert.deepEqual(un.argv, ["gemini", "-p", "review it", "-o", "stream-json"]);
  const walled = buildHeadlessInvocation("gemini", { prompt: "review it", walled: true, model: "gemini-3-pro" });
  assert.deepEqual(walled.argv, ["gemini", "-p", "review it", "-o", "stream-json", "--approval-mode", "yolo", "-m", "gemini-3-pro"]);
  assert.ok(!walled.argv.includes("--sandbox"), "Seatbelt doesn't nest — gemini's sandbox never rides under our wall");
});

test("openclaw stays unwired: buildHeadlessInvocation refuses with the D2 message", () => {
  assert.throws(() => buildHeadlessInvocation("openclaw", { prompt: "x" }), /no headless wire/);
});

test("parseSessionId (opencode): tolerant probes across event homes", () => {
  assert.equal(parseSessionId("opencode", JSON.stringify({ type: "x", sessionID: "ses_top" })), "ses_top");
  assert.equal(parseSessionId("opencode", JSON.stringify({ type: "x", properties: { sessionID: "ses_prop" } })), "ses_prop");
  assert.equal(parseSessionId("opencode", JSON.stringify({ type: "x", properties: { info: { sessionID: "ses_info" } } })), "ses_info");
  assert.equal(parseSessionId("opencode", "not json"), undefined);
});

test("detection: binaries + labels for the expansion; honest auth markers", () => {
  assert.equal(binaryFor("opencode"), "opencode");
  assert.equal(binaryFor("aider"), "aider");
  assert.equal(binaryFor("gemini"), "gemini");
  assert.equal(binaryFor("openclaw"), "openclaw");
  assert.equal(agentLabel("opencode"), "OpenCode");
  assert.equal(agentLabel("gemini"), "Gemini CLI");

  const home = mkdtempSync(join(tmpdir(), "crate2-exp-"));
  // opencode: not signed in → fix names `opencode auth login`; marker file clears it
  assert.match(seatAuthProblem("opencode", home)!.fix, /opencode auth login/);
  mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
  writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), "{}");
  assert.equal(seatAuthProblem("opencode", home), undefined);
  // gemini: oauth creds clear it (env-var path also honored in code)
  const g = seatAuthProblem("gemini", home);
  if (process.env.GEMINI_API_KEY) {
    assert.equal(g, undefined);
  } else {
    assert.match(g!.fix, /Google sign-in|GEMINI_API_KEY/);
    mkdirSync(join(home, ".gemini"), { recursive: true });
    // CE-138 (2026-08-18): OAuth creds are valid-looking but UNSERVABLE —
    // Google retired the CLI's free individual tier, so creds alone must
    // NOT read ready (that false-ready wedged a live seat). Key-only now.
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");
    assert.notEqual(seatAuthProblem("gemini", home), undefined, "OAuth creds alone are a false-ready — refused");
    const hadKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "k";
    try {
      assert.equal(seatAuthProblem("gemini", home), undefined, "an API key is the one working path");
    } finally {
      if (hadKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = hadKey;
    }
  }
  // aider/openclaw manage their own auth — never blocked on a marker
  assert.equal(seatAuthProblem("aider", home), undefined);
  assert.equal(seatAuthProblem("openclaw", home), undefined);
});
