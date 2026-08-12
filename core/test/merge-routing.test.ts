// The ONE deterministic [MERGE] route (2026-08-11; FLAWS "[MERGE] routing is
// nondeterministic across loops"): the operator's gate_release emit ITSELF
// mails the coder — same route from every surface — a repeat release is
// absorbed, an unarmed release mails nobody, and a hand-sent duplicate
// [MERGE] via `deliver` is absorbed only when the order is provably on file
// (fail-OPEN otherwise: at-least-once). Drives the REAL bin/agentctl.py.
// makeRig writes an EMPTY handoffs.yaml on purpose — the route must work with
// NO yaml entry (it is hardcoded so rig-config vintage can never disarm it).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-mergeroute-"));

function makeRig(name: string, conf = ""): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), `PROJECT="rig"\n${conf}`);
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

function driveToApproved(rig: string, ...kv: string[]): void {
  ctl(rig, "emit", "start_impl", "--actor", "coder", ...kv);
  ctl(rig, "emit", "code_ready", "--actor", "coder", ...kv);
  ctl(rig, "emit", "approved", "--actor", "orchestrator", ...kv);
}

/** The coder's maildir wake files (the part a runner actually acts on). */
function coderMail(rig: string): string[] {
  const dir = join(rig, ".agents", "state", "inbox", "coder", "new");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".msg")).sort() : [];
}

function coderMirror(rig: string): string {
  const p = join(rig, ".agents", "state", "inbox", "coder.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

test("CLI gate_release on an approved task mails EXACTLY ONE [MERGE] — maildir wake + mirror", () => {
  const rig = makeRig("route");
  driveToApproved(rig);
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
  assert.match(rel.out, /SIGNAL QUEUED for coder/, "the emit itself must announce the queued merge order");
  const mail = coderMail(rig);
  assert.equal(mail.length, 1, "exactly one maildir wake file");
  const body = readFileSync(join(rig, ".agents", "state", "inbox", "coder", "new", mail[0]!), "utf8");
  assert.match(body, /\[MERGE\] the approved branch/);
  assert.match(body, /merge go/);
  const mergeLines = coderMirror(rig).split("\n").filter((l) => l.includes("[MERGE]"));
  assert.equal(mergeLines.length, 1, "exactly one [MERGE] line in the coder mirror");
  // and the order is ACTIONABLE: the coder's deployed now passes the gate
  assert.ok(ctl(rig, "emit", "deployed", "--actor", "coder").ok);
});

test("a REPEAT CLI gate_release is ABSORBED — no second [MERGE], honest log line", () => {
  const rig = makeRig("repeat");
  driveToApproved(rig);
  assert.ok(ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go").ok);
  const again = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(again.ok, again.out); // an absorb is a success, not a refusal
  assert.match(again.out, /repeat absorbed \(no duplicate merge order\)/);
  assert.equal(coderMail(rig).length, 1, "still exactly one merge order");
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  assert.match(log, /GATE_RELEASE_ABSORBED/, "the repeat must be visible in the audit trail");
  assert.equal(log.split("\n").filter((l) => l.includes(" GATE_RELEASE ")).length, 1,
    "only ONE real GATE_RELEASE event — the absorb never fakes a second release");
});

test("a hand-sent duplicate [MERGE] via deliver is absorbed with an honest engine note", () => {
  const rig = makeRig("dup");
  driveToApproved(rig);
  ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  const d = ctl(rig, "deliver", "coder", "--from", "orchestrator", "[MERGE] the approved branch — merge into main now.");
  assert.ok(d.ok, d.out);
  assert.match(d.out, /duplicate \[MERGE\] absorbed/);
  assert.equal(coderMail(rig).length, 1, "no second maildir file");
  assert.match(coderMirror(rig), /\(engine\) duplicate \[MERGE\] absorbed/,
    "the absorb leaves an engine-voiced note in the mirror");
});

test("a hand-sent [MERGE] with NO release on file DELIVERS (fail-open — never swallow a merge order)", () => {
  const rig = makeRig("open");
  driveToApproved(rig); // armed but NOT released
  const d = ctl(rig, "deliver", "coder", "--from", "orchestrator", "[MERGE] the approved branch — merge now.");
  assert.ok(d.ok, d.out);
  assert.equal(coderMail(rig).length, 1, "the hand-sent order is delivered, not absorbed");
});

test("gate_release while NOT approved records the release but mails NOBODY (honest note)", () => {
  const rig = makeRig("unarmed");
  ctl(rig, "emit", "start_impl", "--actor", "coder"); // implementing — gate not armed
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
  assert.match(rel.out, /NO merge order was sent/);
  assert.match(rel.out, /not armed/);
  assert.equal(coderMail(rig).length, 0, "an unarmed release must not order a merge");
});

test("concurrent mode: the [MERGE] names the released task; unknown-task duplicates fail OPEN", () => {
  const rig = makeRig("conc", 'CONCURRENT_LOOPS="1"\n');
  driveToApproved(rig, "task=feat/a");
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go", "branch=feat/a");
  assert.ok(rel.ok, rel.out);
  const mail = coderMail(rig);
  assert.equal(mail.length, 1);
  const body = readFileSync(join(rig, ".agents", "state", "inbox", "coder", "new", mail[0]!), "utf8");
  assert.match(body, /\[MERGE\] feat\/a/, "the merge order names the released task");
  // a hand-sent duplicate for the SAME task absorbs…
  const dup = ctl(rig, "deliver", "coder", "--from", "orchestrator", "[MERGE] feat/a — merge into main now.");
  assert.match(dup.out, /duplicate \[MERGE\] absorbed/);
  assert.equal(coderMail(rig).length, 1);
  // …but one naming NO known task cannot be checked → delivered with a warning
  const unknown = ctl(rig, "deliver", "coder", "--from", "orchestrator", "[MERGE] feat/zzz — merge now.");
  assert.ok(unknown.ok, unknown.out);
  assert.match(unknown.out, /delivering anyway/);
  assert.equal(coderMail(rig).length, 2, "the unparseable order is delivered (at-least-once)");
});
