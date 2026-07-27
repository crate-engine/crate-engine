import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentProblem, agentStatus, binaryFor, seatAuthProblem, whichBin } from "../src/detect.js";
// T8: the up()-boot readiness-refusal test was removed with cmux (up is gone);
// agent readiness is surfaced by the doctor / Health menu now.

// The P6-6 direction change: the engine never installs or signs in agents —
// it DETECTS what's already on the machine (binary + markers) and says the
// truth loudly (staffing offers, doctor warn, boot refusal). Never five
// silent panes.

const scratch = mkdtempSync(join(tmpdir(), "crate2-auth-"));

/** A fake PATH dir holding exactly the given binaries. */
function fakeBin(...names: string[]): string {
  const dir = mkdtempSync(join(scratch, "bin-"));
  for (const n of names) {
    writeFileSync(join(dir, n), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, n), 0o755);
  }
  return dir;
}

test("whichBin/binaryFor: PATH resolution is injectable and honest", () => {
  const bin = fakeBin("pi");
  assert.equal(whichBin("pi", { path: bin }), join(bin, "pi"));
  assert.equal(whichBin("claude", { path: bin }), undefined);
  assert.equal(whichBin("pi", { path: "" }), undefined);
  assert.equal(binaryFor("pi"), "pi");
  assert.equal(binaryFor("claude"), "claude");
  assert.equal(binaryFor("claude-code"), "claude");
  assert.equal(binaryFor("hermes"), undefined, "unknown agents are their own responsibility");
});

test("auth markers: pi = ~/.pi/agent/auth.json; claude = oauthAccount in ~/.claude.json", () => {
  const fresh = join(scratch, "home-fresh");
  mkdirSync(fresh, { recursive: true });
  assert.ok(seatAuthProblem("pi", fresh), "fresh pi must be a problem");
  assert.match(seatAuthProblem("pi", fresh)!.fix, /\/login/);
  assert.ok(seatAuthProblem("claude", fresh), "fresh claude must be a problem");
  assert.match(seatAuthProblem("claude", fresh)!.fix, /claude/);

  const authed = join(scratch, "home-authed");
  mkdirSync(join(authed, ".pi", "agent"), { recursive: true });
  writeFileSync(join(authed, ".pi", "agent", "auth.json"), "{}");
  writeFileSync(
    join(authed, ".claude.json"),
    JSON.stringify({ oauthAccount: { email: "x@y" }, hasCompletedOnboarding: true }),
  );
  assert.equal(seatAuthProblem("pi", authed), undefined);
  assert.equal(seatAuthProblem("claude", authed), undefined);

  // a claude.json WITHOUT the oauth marker (logged out) is still a problem
  const loggedOut = join(scratch, "home-loggedout");
  mkdirSync(loggedOut, { recursive: true });
  writeFileSync(join(loggedOut, ".claude.json"), "{}");
  assert.ok(seatAuthProblem("claude", loggedOut));

  // run #5 finding #3: a TOKEN without completed FIRST-RUN still re-prompts a
  // booted seat — the marker demands both
  const tokenOnly = join(scratch, "home-token-only");
  mkdirSync(tokenOnly, { recursive: true });
  writeFileSync(join(tokenOnly, ".claude.json"), JSON.stringify({ oauthAccount: { email: "x@y" } }));
  const tp = seatAuthProblem("claude", tokenOnly);
  assert.ok(tp, "token-only claude must still be a problem");
  assert.match(tp!.fix, /first-run/);

  // other agents manage their own auth
  assert.equal(seatAuthProblem("hermes", fresh), undefined);
});

test("codex detection: binary + ~/.codex/auth.json marker (run #7 — agent-agnostic card)", () => {
  const home = join(scratch, "home-codex");
  mkdirSync(home, { recursive: true });
  const bin = fakeBin("codex");
  // installed, not signed in
  const p = agentProblem("codex", home, [], { path: bin });
  assert.ok(p, "codex without auth.json must be a problem");
  assert.match(p!.fix, /not signed in/);
  // not installed beats not signed in
  assert.match(agentProblem("codex", home, [], { path: "" })!.fix, /isn't installed/);
  // signed in → ready
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "auth.json"), "{}");
  assert.equal(agentProblem("codex", home, [], { path: bin }), undefined);
});

test("agentProblem: not installed BEATS not signed in; ready = installed + authed", () => {
  const home = join(scratch, "home-detect");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "auth.json"), '{"openai-codex":{}}');
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: { email: "x@y" }, hasCompletedOnboarding: true }),
  );
  // markers green but NOTHING installed → the fix says install, not /login
  const noBin = agentProblem("pi", home, ["openai-codex/gpt-5.5"], { path: "" });
  assert.ok(noBin, "missing binary must be a problem even with green markers");
  assert.match(noBin!.fix, /isn't installed/);
  const noClaude = agentProblem("claude", home, ["opus"], { path: "" });
  assert.ok(noClaude);
  assert.match(noClaude!.fix, /isn't installed/);
  // binary present + markers green → ready
  const bin = fakeBin("pi", "claude");
  assert.equal(agentProblem("pi", home, ["openai-codex/gpt-5.5"], { path: bin }), undefined);
  assert.equal(agentProblem("claude", home, ["opus"], { path: bin }), undefined);
  // binary present, marker missing → the marker problem shows through
  const bare = join(scratch, "home-bare");
  mkdirSync(bare, { recursive: true });
  assert.match(agentProblem("pi", bare, [], { path: bin })!.fix, /\/login/);
});

test("deep check (run #10): green markers but a stale real credential is a PROBLEM, not a boot surprise", () => {
  const home = join(scratch, "home-deep");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: { email: "x@y" }, hasCompletedOnboarding: true }),
  );
  // a claude whose auth status says NOT logged in (markers lie; keychain stale)
  const staleBin = mkdtempSync(join(scratch, "bin-"));
  writeFileSync(join(staleBin, "claude"), '#!/bin/sh\necho \'{"loggedIn": false}\'\n');
  chmodSync(join(staleBin, "claude"), 0o755);
  assert.equal(agentProblem("claude", home, ["opus"], { path: staleBin }), undefined, "shallow stays marker-only");
  const deep = agentProblem("claude", home, ["opus"], { path: staleBin, deep: true });
  assert.ok(deep, "deep must catch the stale credential");
  assert.match(deep!.fix, /keychain|token/i);
  // a claude whose auth status confirms → ready
  const freshBin = mkdtempSync(join(scratch, "bin-"));
  writeFileSync(join(freshBin, "claude"), '#!/bin/sh\necho \'{"loggedIn": true}\'\n');
  chmodSync(join(freshBin, "claude"), 0o755);
  assert.equal(agentProblem("claude", home, ["opus"], { path: freshBin, deep: true }), undefined);
});

test("agentStatus: staffed-agent readiness matches the boot's resolution (the health screen's soft pre-gate)", () => {
  const home = join(scratch, "home-status");
  mkdirSync(join(home, ".crate"), { recursive: true });
  // verified staffing: coder on claude, four seats on pi
  writeFileSync(
    join(home, ".crate", "defaults.yaml"),
    [
      "seats:",
      "  orchestrator: { agent: pi, model: openai-codex/gpt-5.5 }",
      "  coder: { agent: claude, model: opus }",
      "  reviewer: { agent: pi, model: openai-codex/gpt-5.5 }",
      "  designer: { agent: pi, model: openai-codex/gpt-5.5 }",
      "  tester: { agent: pi, model: openai-codex/gpt-5.5 }",
    ].join("\n"),
  );
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "auth.json"), '{"openai-codex":{}}');
  // machine has pi only — claude seat must read NOT INSTALLED, pi READY
  const s = agentStatus({ home, path: fakeBin("pi") });
  const pi = s.find((a) => a.agent === "pi")!;
  const claude = s.find((a) => a.agent === "claude")!;
  assert.equal(pi.ready, true);
  assert.equal(pi.installed, true);
  assert.deepEqual(pi.seats, ["Orchestrator", "Reviewer", "Designer", "QA"]);
  assert.equal(claude.ready, false);
  assert.equal(claude.installed, false);
  assert.deepEqual(claude.seats, ["Coder"]);
  assert.match(claude.fix!, /isn't installed/);
});

test("pi marker is PROVIDER-aware (run #3: existence-only went green on a wrong-provider login)", () => {
  const home = join(scratch, "home-provider");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
  // no models known → existence-only (unchanged behavior)
  assert.equal(seatAuthProblem("pi", home), undefined);
  // seats staffed on openai-codex → that provider KEY must be present
  const p = seatAuthProblem("pi", home, ["openai-codex/gpt-5.5", "openai-codex/gpt-5.5"]);
  assert.ok(p, "wrong-provider login must be a problem");
  assert.match(p!.fix, /openai-codex/);
  assert.match(p!.fix, /choose ChatGPT/);
  // the right key satisfies it
  writeFileSync(join(home, ".pi", "agent", "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth" } }));
  assert.equal(seatAuthProblem("pi", home, ["openai-codex/gpt-5.5"]), undefined);
  // run #11: a deepseek-staffed seat now demands its key too (the Coder booted
  // keyless and died at runtime); the fix names both auth paths
  const dp = seatAuthProblem("pi", home, ["deepseek/deepseek-v4-pro"]);
  assert.ok(dp, "deepseek without a key must be a problem");
  assert.match(dp!.fix, /deepseek/);
  assert.match(dp!.fix, /DEEPSEEK_API_KEY/);
  writeFileSync(
    join(home, ".pi", "agent", "auth.json"),
    JSON.stringify({ "openai-codex": { type: "oauth" }, deepseek: { type: "api-key" } }),
  );
  assert.equal(seatAuthProblem("pi", home, ["deepseek/deepseek-v4-pro"]), undefined);
  // unknown providers still never trip the check (adapter-specific auth)
  assert.equal(seatAuthProblem("pi", home, ["anthropic/claude-opus-4-8"]), undefined);
});
