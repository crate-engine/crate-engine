// PHASE-8 T3: the "merge go" gate is machine physics. The merge (deployed)
// refuses unless the OPERATOR released THIS task since it reached approved,
// with the exact phrase "merge go". Drives the REAL bin/agentctl.py.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-mergego-"));

function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  writeFileSync(
    join(rig, ".agents", "config", "state-machine.yaml"),
    [
      "initial: idle",
      "always_legal: checkpoint, gate_pass, gate_release",
      "transitions:",
      "  start_impl: idle -> implementing",
      "  code_ready: implementing -> code_ready",
      "  approved: code_ready -> approved",
      "  deployed: approved -> deployed",
      "  reopen: approved -> implementing",
    ].join("\n"),
  );
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
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

function driveToApproved(rig: string): void {
  ctl(rig, "emit", "start_impl", "--actor", "coder");
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  ctl(rig, "emit", "approved", "--actor", "orchestrator");
}

test("deployed is REFUSED at approved with no operator release", () => {
  const rig = makeRig("hold");
  driveToApproved(rig);
  const r = ctl(rig, "emit", "deployed", "--actor", "orchestrator");
  assert.equal(r.ok, false);
  assert.match(r.out, /HELD at the gate|no operator 'merge go'/);
});

test("gate_release requires actor=operator", () => {
  const rig = makeRig("actor");
  driveToApproved(rig);
  const r = ctl(rig, "emit", "gate_release", "--actor", "orchestrator", 'phrase=merge go');
  assert.equal(r.ok, false);
  assert.match(r.out, /OPERATOR's alone/);
});

test("gate_release requires the EXACT phrase 'merge go'", () => {
  const rig = makeRig("phrase");
  driveToApproved(rig);
  const r = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge it");
  assert.equal(r.ok, false);
  assert.match(r.out, /must be exactly 'merge go'/);
});

test("operator 'merge go' → deployed is ALLOWED", () => {
  const rig = makeRig("go");
  driveToApproved(rig);
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
  const dep = ctl(rig, "emit", "deployed", "--actor", "orchestrator");
  assert.ok(dep.ok, dep.out);
  assert.match(dep.out, /state=deployed/);
});

test("a release is CONSUMED: a reopened+re-approved task needs a FRESH merge go", () => {
  const rig = makeRig("consume");
  driveToApproved(rig);
  ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  ctl(rig, "emit", "reopen", "--actor", "orchestrator"); // bug found post-approve → back to implementing
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  ctl(rig, "emit", "approved", "--actor", "orchestrator");
  // the OLD release must not authorize the NEW merge
  const stale = ctl(rig, "emit", "deployed", "--actor", "orchestrator");
  assert.equal(stale.ok, false, "a pre-reopen release must not merge the re-approved task");
  ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(ctl(rig, "emit", "deployed", "--actor", "orchestrator").ok);
});
