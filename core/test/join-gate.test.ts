// THE JOIN IS PHYSICS (2026-07-24; FLAWS "the review/QA JOIN is manners, not
// physics"): in a parallel review+QA loop the verifiers RECORD verdicts
// (`emit verdict`) and agentctl refuses approved/changes_needed from anyone
// but the orchestrator — and, with JOIN_ENFORCE=1, until BOTH verdicts are on
// record since the last code_ready. Drives the REAL bin/agentctl.py against
// the REAL shipped config (run-#14 fixture law), and replays the live-proven
// race from dev/plan/proofs/speed-law/ to prove it can no longer happen.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTCTL = join(ROOT, "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-join-"));

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

function ctl(rig: string, env: Record<string, string>, ...args: string[]): { ok: boolean; out: string } {
  try {
    return {
      ok: true,
      out: execFileSync("python3", [AGENTCTL, ...args], {
        cwd: rig, encoding: "utf8", env: { ...process.env, ...env },
      }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

function driveToCodeReady(rig: string): void {
  ctl(rig, {}, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, {}, "emit", "start_impl", "--actor", "orchestrator");
  const r = ctl(rig, {}, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
}

// ── the live-proven race (speed-law proof, 2026-07-13 20:08–20:09) ──────────
// The reviewer solo-emitted CHANGES_NEEDED and then APPROVED while QA was
// still mid-turn. Replay both moves: physics must refuse each one.

test("RACE REPLAY: reviewer's solo changes_needed is REFUSED", () => {
  const rig = makeRig("race-cn");
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "changes_needed", "--actor", "reviewer");
  assert.equal(r.ok, false, "the 20:08:03 CHANGES_NEEDED must no longer be possible");
  assert.match(r.out, /JOIN belongs to the ORCHESTRATOR/);
  // and the state did NOT move
  assert.equal(ctl(rig, {}, "state").out.trim(), "code_ready");
});

test("RACE REPLAY: reviewer's solo approved is REFUSED (state stays put)", () => {
  const rig = makeRig("race-ap");
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "approved", "--actor", "reviewer");
  assert.equal(r.ok, false, "the 20:09:35 APPROVED must no longer be possible");
  assert.match(r.out, /JOIN belongs to the ORCHESTRATOR/);
  assert.equal(ctl(rig, {}, "state").out.trim(), "code_ready");
});

test("a tester solo emit is refused the same way", () => {
  const rig = makeRig("race-qa");
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "approved", "--actor", "tester");
  assert.equal(r.ok, false);
  assert.match(r.out, /JOIN belongs to the ORCHESTRATOR/);
});

// ── the verdict record ──────────────────────────────────────────────────────

test("verdict: verifiers only, result must be approve|reject", () => {
  const rig = makeRig("verdict-validate");
  driveToCodeReady(rig);
  const coder = ctl(rig, {}, "emit", "verdict", "--actor", "coder", "result=approve");
  assert.equal(coder.ok, false);
  assert.match(coder.out, /VERIFIER's record/);
  const bad = ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=maybe");
  assert.equal(bad.ok, false);
  assert.match(bad.out, /result=approve or result=reject/);
});

test("verdict records AND mails the orchestrator in one emit", () => {
  const rig = makeRig("verdict-mail");
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=approve", "report=clean");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /SIGNAL QUEUED for orchestrator/);
  const mails = readdirSync(join(rig, ".agents", "state", "inbox", "orchestrator", "new"));
  assert.equal(mails.length, 1);
});

// ── enforcement (JOIN_ENFORCE=1) ────────────────────────────────────────────

const ENFORCE = 'PROJECT="rig"\nJOIN_ENFORCE="1"\n';

test("enforced: approved refused until BOTH verdicts are on record and green", () => {
  const rig = makeRig("enforce", ENFORCE);
  driveToCodeReady(rig);
  const none = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.equal(none.ok, false);
  assert.match(none.out, /no verdict on record from: reviewer, tester/);
  ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=approve");
  const one = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.equal(one.ok, false);
  assert.match(one.out, /no verdict on record from: tester/);
  ctl(rig, {}, "emit", "verdict", "--actor", "tester", "result=approve");
  const both = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.ok(both.ok, both.out);
  assert.match(both.out, /state=approved/);
});

test("enforced: a recorded REJECT blocks approved but allows changes_needed", () => {
  const rig = makeRig("enforce-reject", ENFORCE);
  driveToCodeReady(rig);
  ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=approve");
  ctl(rig, {}, "emit", "verdict", "--actor", "tester", "result=reject", "report=mobile overflow");
  const ap = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.equal(ap.ok, false, "QA is decisive — a recorded reject must block approved");
  assert.match(ap.out, /recorded REJECT from: tester/);
  const cn = ctl(rig, {}, "emit", "changes_needed", "--actor", "orchestrator");
  assert.ok(cn.ok, cn.out);
  assert.match(cn.out, /state=implementing/);
});

test("enforced: changes_needed also waits for BOTH (one consolidated round, not two)", () => {
  const rig = makeRig("enforce-cn", ENFORCE);
  driveToCodeReady(rig);
  ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=reject");
  const early = ctl(rig, {}, "emit", "changes_needed", "--actor", "orchestrator");
  assert.equal(early.ok, false, "a reviewer-alone rework would whipsaw the coder when QA lands");
  assert.match(early.out, /no verdict on record from: tester/);
});

test("a new code_ready VOIDS recorded verdicts (fresh sha = fresh join)", () => {
  const rig = makeRig("reset", ENFORCE);
  driveToCodeReady(rig);
  ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "result=reject");
  ctl(rig, {}, "emit", "verdict", "--actor", "tester", "result=reject");
  assert.ok(ctl(rig, {}, "emit", "changes_needed", "--actor", "orchestrator").ok);
  // rework round: fix_ready is the same CODE_READY event — old verdicts are void
  assert.ok(ctl(rig, {}, "emit", "fix_ready", "--actor", "coder", "branch=feature/x").ok);
  const stale = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.equal(stale.ok, false, "round-1 verdicts must not cover round-2 code");
  assert.match(stale.out, /no verdict on record/);
});

test("advisory (flag off): orchestrator's join proceeds with a WARNING", () => {
  const rig = makeRig("advisory");
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /WARNING: the JOIN is not mechanically complete/);
});

test("JOIN_OVERRIDE=1 bypasses and is stamped into the log", () => {
  const rig = makeRig("override", ENFORCE);
  driveToCodeReady(rig);
  const r = ctl(rig, { JOIN_OVERRIDE: "1" }, "emit", "approved", "--actor", "reviewer");
  assert.ok(r.ok, r.out);
  const log = ctl(rig, {}, "tail", "50").out;
  assert.match(log, /APPROVED .*join_override=1/);
});

test("non-parallel rig (no reviewer+tester fan-out) keeps its old shape", () => {
  const rig = makeRig("solo");
  writeFileSync(
    join(rig, ".agents", "config", "handoffs.yaml"),
    "handoffs:\n  code_ready: code_ready | coder | reviewer | [CODE_READY] | branch\n",
  );
  driveToCodeReady(rig);
  const r = ctl(rig, {}, "emit", "approved", "--actor", "reviewer");
  assert.ok(r.ok, "a reviewer-only loop's reviewer may still emit its own approved");
});

// ── concurrent mode: verdicts file under their task ─────────────────────────

test("concurrent: task A's verdicts never satisfy task B's join", () => {
  const rig = makeRig("tasks", 'PROJECT="rig"\nCONCURRENT_LOOPS="1"\nJOIN_ENFORCE="1"\n');
  ctl(rig, {}, "emit", "boot", "--actor", "orchestrator");
  for (const t of ["feature/a", "feature/b"]) {
    ctl(rig, {}, "emit", "start_impl", "--actor", "orchestrator", `task=${t}`);
    assert.ok(ctl(rig, {}, "emit", "code_ready", "--actor", "coder", `task=${t}`).ok);
  }
  ctl(rig, {}, "emit", "verdict", "--actor", "reviewer", "task=feature/a", "result=approve");
  ctl(rig, {}, "emit", "verdict", "--actor", "tester", "task=feature/a", "result=approve");
  const b = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator", "task=feature/b");
  assert.equal(b.ok, false, "task A's verdicts must not close task B");
  assert.match(b.out, /no verdict on record/);
  const a = ctl(rig, {}, "emit", "approved", "--actor", "orchestrator", "task=feature/a");
  assert.ok(a.ok, a.out);
});
