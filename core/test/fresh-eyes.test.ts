// FRESH EYES at verify dispatch (2026-08-11; FLAWS "the reviewer graded its
// own homework"; PDR dev/pdr/blended-pane.md "auto-refresh-verifiers at
// verify dispatch"): verifier seats keep ONE persistent session across loops,
// so a reviewer/tester session that earlier AUTHORED the branch's code would
// verify its own work. The cure is mechanical — the code_ready fan-out drops
// each verifier's session.json (the runner's sanctioned fresh-start lever)
// BEFORE queueing the verify mail, so the woken runner cannot resume the old
// session in the fs.watch gap. Drives the REAL bin/agentctl.py against the
// REAL shipped config (run-#14 fixture law), join-gate.test.ts pattern.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTCTL = join(ROOT, "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-fresheyes-"));

function makeRig(name: string, conf = 'PROJECT="rig"\n'): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), conf);
  copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  return rig;
}

function ctl(rig: string, ...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8" }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** Persist a fake live session for a seat — the thing fresh-eyes must drop. */
function seedSession(rig: string, seat: string): string {
  const dir = join(rig, ".agents", "state", "turns", seat);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "session.json");
  writeFileSync(f, JSON.stringify({ agent: "claude", sessionId: "s1" }));
  return f;
}

function events(rig: string): string {
  return readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
}

function mails(rig: string, role: string): number {
  const dir = join(rig, ".agents", "state", "inbox", role, "new");
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

function driveToImplementing(rig: string, ...startKv: string[]): void {
  assert.ok(ctl(rig, "emit", "boot", "--actor", "orchestrator").ok);
  assert.ok(ctl(rig, "emit", "start_impl", "--actor", "orchestrator", ...startKv).ok);
}

// ── T1 happy path + T6 non-verifiers untouched ──────────────────────────────

test("code_ready drops BOTH verifier sessions before the mail lands; other seats untouched", () => {
  const rig = makeRig("happy");
  driveToImplementing(rig);
  const reviewer = seedSession(rig, "reviewer");
  const tester = seedSession(rig, "tester");
  const coder = seedSession(rig, "coder");
  const orchestrator = seedSession(rig, "orchestrator");
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  // fresh eyes: both verifier sessions dropped, honestly narrated
  assert.equal(existsSync(reviewer), false, "reviewer session must be dropped");
  assert.equal(existsSync(tester), false, "tester session must be dropped");
  assert.match(r.out, /verify dispatch: reviewer session refreshed — fresh eyes/);
  assert.match(r.out, /verify dispatch: tester session refreshed — fresh eyes/);
  const log = events(rig);
  assert.match(log, /SESSION_REFRESH actor=agentctl seat=reviewer reason=fresh_eyes/);
  assert.match(log, /SESSION_REFRESH actor=agentctl seat=tester reason=fresh_eyes/);
  // D12 turns.log convention: the seat's history shows the drop
  for (const seat of ["reviewer", "tester"]) {
    const tl = readFileSync(join(rig, ".agents", "state", "turns", seat, "turns.log"), "utf8");
    assert.match(tl, /refreshed \(verify dispatch\) \| session dropped — fresh eyes/);
  }
  // the handoff itself is untouched: mail queued, state advanced
  assert.equal(mails(rig, "reviewer"), 1);
  assert.equal(mails(rig, "tester"), 1);
  assert.equal(ctl(rig, "state").out.trim(), "code_ready");
  // T6: authors keep their sessions — only VERIFIERS get fresh eyes
  assert.equal(existsSync(coder), true, "coder session must survive");
  assert.equal(existsSync(orchestrator), true, "orchestrator session must survive");
});

// ── T2 absent session ───────────────────────────────────────────────────────

test("no session on disk = honest skip, emit still succeeds", () => {
  const rig = makeRig("absent");
  driveToImplementing(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  const log = events(rig);
  assert.match(log, /SESSION_REFRESH_SKIPPED actor=agentctl seat=reviewer reason=no_session/);
  assert.match(log, /SESSION_REFRESH_SKIPPED actor=agentctl seat=tester reason=no_session/);
  assert.doesNotMatch(log, /SESSION_REFRESH actor/);
  assert.equal(mails(rig, "reviewer"), 1);
  assert.equal(mails(rig, "tester"), 1);
});

// ── T3 mid-turn safety ──────────────────────────────────────────────────────

test("a LIVE mid-turn verifier keeps its session (skip on record); the other still refreshes", () => {
  const rig = makeRig("midturn");
  driveToImplementing(rig);
  const reviewer = seedSession(rig, "reviewer");
  const tester = seedSession(rig, "tester");
  // reviewer is mid-turn: active.lock names THIS live test process
  writeFileSync(join(rig, ".agents", "state", "turns", "reviewer", "active.lock"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.equal(existsSync(reviewer), true, "mid-turn reviewer session must SURVIVE");
  assert.equal(existsSync(tester), false, "idle tester still gets fresh eyes");
  assert.match(events(rig), /SESSION_REFRESH_SKIPPED actor=agentctl seat=reviewer reason=mid_turn/);
  assert.match(events(rig), /SESSION_REFRESH actor=agentctl seat=tester reason=fresh_eyes/);
  assert.match(r.out, /reviewer is mid-turn — session NOT refreshed/);
  // the lock is READ-ONLY here — the TS runner owns its lifecycle
  assert.equal(existsSync(join(rig, ".agents", "state", "turns", "reviewer", "active.lock")), true);
});

test("a STALE lock (dead pid) does not block the refresh", () => {
  const rig = makeRig("stalelock");
  driveToImplementing(rig);
  const reviewer = seedSession(rig, "reviewer");
  seedSession(rig, "tester");
  writeFileSync(join(rig, ".agents", "state", "turns", "reviewer", "active.lock"),
    JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.equal(existsSync(reviewer), false, "dead-pid lock is stale, not busy — refresh proceeds");
  assert.match(events(rig), /SESSION_REFRESH actor=agentctl seat=reviewer reason=fresh_eyes/);
});

// ── T4 chore tier: no verifier fan-out = no refresh ─────────────────────────
// A chore's code_ready is rewritten to the orchestrator alone by the tier
// router, so fresh-eyes must refresh NOBODY. Needs a real git rig (the
// floors diff against main; no base would escalate chore -> bug).

function git(rig: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: rig, encoding: "utf8" }).trim();
}

test("an honest chore refreshes nobody (no verifier fan-out to freshen)", () => {
  const rig = makeRig("chore");
  git(rig, "init", "-qb", "main");
  git(rig, "config", "user.email", "t@t");
  git(rig, "config", "user.name", "t");
  writeFileSync(join(rig, "app.txt"), "hello\n");
  writeFileSync(join(rig, ".gitignore"), ".agents/\n");
  git(rig, "add", "-A");
  git(rig, "commit", "-qm", "base");
  git(rig, "checkout", "-qb", "feature/x");
  driveToImplementing(rig, "tier=chore");
  writeFileSync(join(rig, "app.txt"), "hello fixed\n");
  git(rig, "add", "-A");
  git(rig, "commit", "-qm", "work");
  assert.ok(ctl(rig, "emit", "gate_pass", "--actor", "coder", `sha=${git(rig, "rev-parse", "HEAD")}`).ok);
  const reviewer = seedSession(rig, "reviewer");
  const tester = seedSession(rig, "tester");
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /TIER: chore/);
  assert.equal(existsSync(reviewer), true, "chore loop must not touch the reviewer session");
  assert.equal(existsSync(tester), true, "chore loop must not touch the tester session");
  assert.doesNotMatch(events(rig), /SESSION_REFRESH/);
  assert.equal(mails(rig, "orchestrator"), 1);
  assert.equal(mails(rig, "reviewer"), 0);
});

// ── T5 fix_ready rides the same transition = the same fresh eyes ────────────

test("fix_ready (rework round) refreshes the verifiers exactly like code_ready", () => {
  const rig = makeRig("fixready");
  driveToImplementing(rig);
  assert.ok(ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x").ok);
  assert.ok(ctl(rig, "emit", "changes_needed", "--actor", "orchestrator").ok);
  const reviewer = seedSession(rig, "reviewer");
  const tester = seedSession(rig, "tester");
  const r = ctl(rig, "emit", "fix_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.equal(existsSync(reviewer), false, "rework verify must also start fresh");
  assert.equal(existsSync(tester), false);
  assert.match(events(rig), /SESSION_REFRESH actor=agentctl seat=reviewer reason=fresh_eyes/);
  assert.match(events(rig), /SESSION_REFRESH actor=agentctl seat=tester reason=fresh_eyes/);
  assert.equal(mails(rig, "reviewer"), 2, "[CODE_READY] + [FIX_READY] both queued");
});
