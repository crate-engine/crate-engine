// PHASE-7 T6 gate run A — per-task state mechanics, driven through the REAL
// agentctl in a scratch git rig with CONCURRENT_LOOPS=1. The design's claims,
// pinned: task=branch keys, per-task legality (cross-task advance is
// structurally impossible), per-branch pins, refuse-unkeyed-events, the
// mid-flight flip guard, and flag-off = legacy behavior untouched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { readNew } from "../src/mailbox.js";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-t6-"));

let n = 0;
function mkRig(conf: string): string {
  const rig = join(scratch, `rig${++n}`);
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), conf);
  for (const f of ["state-machine.yaml", "handoffs.yaml"]) {
    writeFileSync(join(rig, ".agents", "config", f), readFileSync(join(ROOT, "config", f)));
  }
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  symlinkSync(join(ROOT, "bin"), join(rig, ".agents", "bin")); // rig-wait resolves agentctl here
  const git = (...a: string[]) => execFileSync("git", a, { cwd: rig, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(rig, ".gitignore"), ".agents/\n"); // live state never rides git (the real rigs' managed ignore)
  writeFileSync(join(rig, "f.txt"), "0\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return rig;
}

function ctl(rig: string, ...args: string[]): { out: string; code: number } {
  try {
    return {
      out: execFileSync("python3", [join(ROOT, "bin", "agentctl.py"), ...args], { cwd: rig, encoding: "utf8" }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}
const emit = (rig: string, name: string, ...kv: string[]) =>
  ctl(rig, "emit", name, "--actor", "orchestrator", ...kv);
const git = (rig: string, ...a: string[]) => execFileSync("git", a, { cwd: rig, encoding: "utf8" });

const CONC = 'PROJECT="rig"\nCONCURRENT_LOOPS="1"\n';

test("concurrent: un-keyed task events REFUSE loudly; session events need no key", () => {
  const rig = mkRig(CONC);
  assert.equal(emit(rig, "boot").code, 0, "boot is session-scoped");
  const r = emit(rig, "start_impl");
  assert.equal(r.code, 1);
  assert.match(r.out, /needs task=<branch>/);
});

test("concurrent: two tasks advance independently; the state table shows both; cross-task advance is impossible", () => {
  const rig = mkRig(CONC);
  emit(rig, "boot");
  assert.equal(emit(rig, "start_impl", "branch=feature/a").code, 0);
  assert.equal(emit(rig, "start_impl", "branch=feature/b").code, 0, "task B starts while A is mid-flight");
  assert.equal(ctl(rig, "state").out.trim(), "feature/a=implementing\nfeature/b=implementing");
  assert.equal(ctl(rig, "state", "--task", "feature/a").out.trim(), "implementing");
  // drive A to code_ready on its real branch (pin written per task)
  git(rig, "checkout", "-qb", "feature/a");
  writeFileSync(join(rig, "f.txt"), "a\n");
  git(rig, "commit", "-qam", "a");
  assert.equal(emit(rig, "code_ready", "branch=feature/a").code, 0);
  // A is at code_ready; a changes_needed for B (implementing) must judge B's OWN state
  const wrong = emit(rig, "changes_needed", "branch=feature/b");
  assert.equal(wrong.code, 1, "B is implementing — changes_needed is illegal FOR B even though A is code_ready");
  assert.match(wrong.out, /task feature\/b's state 'implementing'/);
  // and A's verdict cannot be filed to B: approve A normally
  assert.equal(emit(rig, "approved", "branch=feature/a").code, 0);
  assert.match(ctl(rig, "state").out, /feature\/a=approved/);
  assert.match(ctl(rig, "state").out, /feature\/b=implementing/);
});

test("concurrent: pins are PER BRANCH — B moving never blocks A's join; B's own join re-earns", () => {
  const rig = mkRig(CONC);
  emit(rig, "boot");
  emit(rig, "start_impl", "branch=feature/a");
  emit(rig, "start_impl", "branch=feature/b");
  git(rig, "checkout", "-qb", "feature/a");
  writeFileSync(join(rig, "f.txt"), "a\n");
  git(rig, "commit", "-qam", "a");
  emit(rig, "code_ready", "branch=feature/a");
  git(rig, "checkout", "-qb", "feature/b", "main");
  writeFileSync(join(rig, "f.txt"), "b\n");
  git(rig, "commit", "-qam", "b");
  emit(rig, "code_ready", "branch=feature/b");
  assert.ok(existsSync(join(rig, ".agents", "state", "pins", "feature-a")), "per-task pin A");
  assert.ok(existsSync(join(rig, ".agents", "state", "pins", "feature-b")), "per-task pin B");
  // B's branch moves after its code_ready → B's approved REJECTED, A's approved fine
  writeFileSync(join(rig, "f.txt"), "b2\n");
  git(rig, "commit", "-qam", "b moved");
  const badB = emit(rig, "approved", "branch=feature/b");
  assert.equal(badB.code, 1);
  assert.match(badB.out, /branch moved after code_ready/);
  assert.equal(emit(rig, "approved", "branch=feature/a").code, 0, "A's pin is untouched by B's movement");
});

test("concurrent: close drops a task from the table; all closed = idle", () => {
  const rig = mkRig(CONC);
  emit(rig, "boot");
  emit(rig, "start_impl", "branch=feature/a");
  git(rig, "checkout", "-qb", "feature/a");
  writeFileSync(join(rig, "f.txt"), "a\n");
  git(rig, "commit", "-qam", "a");
  for (const ev of ["code_ready", "approved"]) assert.equal(emit(rig, ev, "branch=feature/a").code, 0);
  // T3: the merge is held until the operator's "merge go" (machine physics)
  assert.equal(emit(rig, "gate_release", 'branch=feature/a', "--actor", "operator", "phrase=merge go").code, 0);
  assert.equal(emit(rig, "deployed", "branch=feature/a").code, 0);
  assert.equal(emit(rig, "close", "branch=feature/a").code, 0);
  assert.equal(ctl(rig, "state").out.trim(), "idle");
});

test("concurrent: a task=-keyed gate_release stamps THE TASK's state, never the scalar (T6 Superman harvest)", () => {
  // Live find (2026-07-12, the T6 headless loop): `emit gate_release
  // task=feature/reverse` — the exact form agentctl's own refusal text
  // recommends — stamped state=initialized (the SESSION scalar) onto a line
  // carrying task=, knocking the approved task back to initialized in the
  // task table and making the released merge ILLEGAL. Always-events must
  // compute their unchanged state from THE KEYED TASK.
  const rig = mkRig(CONC);
  emit(rig, "boot");
  emit(rig, "start_impl", "branch=feature/a");
  git(rig, "checkout", "-qb", "feature/a");
  writeFileSync(join(rig, "f.txt"), "a\n");
  git(rig, "commit", "-qam", "a");
  for (const ev of ["code_ready", "approved"]) assert.equal(emit(rig, ev, "branch=feature/a").code, 0);
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", "task=feature/a", "phrase=merge go");
  assert.equal(rel.code, 0);
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  const relLine = log.split("\n").find((l) => l.includes("GATE_RELEASE"))!;
  assert.match(relLine, /state=approved/, "the logged line must not corrupt the task table");
  assert.equal(emit(rig, "deployed", "branch=feature/a").code, 0, "the released merge stays LEGAL");
});

test("concurrent: flipping the flag on a half-flown scalar session REFUSES", () => {
  const rig = mkRig('PROJECT="rig"\n'); // legacy
  emit(rig, "boot");
  assert.equal(emit(rig, "start_impl").code, 0); // scalar session mid-flight
  writeFileSync(join(rig, ".agents", "rig.conf"), CONC); // flip ON
  const r = emit(rig, "code_ready", "branch=feature/x");
  assert.equal(r.code, 1);
  assert.match(r.out, /half-flown scalar session/);
});

test("legacy (flag off): behavior unchanged — no task keys needed, scalar state, single pin path", () => {
  const rig = mkRig('PROJECT="rig"\n');
  emit(rig, "boot");
  assert.equal(emit(rig, "start_impl").code, 0);
  assert.equal(ctl(rig, "state").out.trim(), "implementing");
  git(rig, "checkout", "-qb", "feature/x");
  writeFileSync(join(rig, "f.txt"), "x\n");
  git(rig, "commit", "-qam", "x");
  assert.equal(emit(rig, "code_ready").code, 0);
  assert.ok(existsSync(join(rig, ".agents", "state", "pin-code_ready")), "legacy pin file path");
});

test("rig-wait --task watches one task only", () => {
  const rig = mkRig(CONC);
  emit(rig, "boot");
  emit(rig, "start_impl", "branch=feature/a");
  // baseline deliberately WRONG for A → exits immediately with A's real state
  const out = execFileSync("bash", [join(ROOT, "bin", "rig-wait.sh"), "--task", "feature/a", "idle", "1"], {
    cwd: rig,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.match(out, /CHANGED: implementing/);
});

test("doctrine pins: orchestrator concurrency laws, coder step-boundary law, deliver-first reporting, template flag", () => {
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(orch, /## Concurrent loops \(rig\.conf `CONCURRENT_LOOPS=1`/);
  assert.match(orch, /MAX_CONCURRENT_LOOPS/);
  assert.match(orch, /Sweep your own inbox/);
  const coder = readFileSync(join(ROOT, "config", "coder.md"), "utf8");
  assert.match(coder, /Switch tasks only at a step boundary/);
  const report = readFileSync(join(ROOT, "config", "skills", "report.md"), "utf8");
  assert.match(report, /agentctl\.py deliver <role>/);
  const attach = readFileSync(join(ROOT, "core", "src", "attach.ts"), "utf8");
  assert.match(attach, /CONCURRENT_LOOPS="0"/);
});

test("deliver: the inbox record is durable and appends (the T6-0 queue)", () => {
  const rig = mkRig(CONC);
  ctl(rig, "deliver", "reviewer", "[ACK] one");
  ctl(rig, "deliver", "reviewer", "[FILE-PLAN] two");
  const inbox = readFileSync(join(rig, ".agents", "state", "inbox", "reviewer.md"), "utf8");
  assert.match(inbox, /\[ACK\] one\n/);
  assert.match(inbox, /\[FILE-PLAN\] two\n/);
  assert.equal(inbox.trim().split("\n").length, 2);
});

// T8a review regression: the maildir wake used to be gated on rig.conf
// COORDINATION="headless" — a flag NOTHING writes since headless became the
// only mode. On a fresh rig (no flag) every deliver wrote only the human
// mirror and the runner never woke: silent message loss, including the GUI
// operator chat (teamctl → deliver). The wake must be unconditional.
test("deliver: queues the runner wake WITHOUT any COORDINATION flag (fresh-rig regression)", () => {
  const rig = mkRig(CONC); // note: no COORDINATION line — the fresh-attach shape
  const r = ctl(rig, "deliver", "reviewer", "--from", "coder", "[CODE_READY] branch=x");
  assert.equal(r.code, 0);
  assert.match(r.out, /QUEUED: reviewer's runner wakes on it/);
  const mail = readNew(join(rig, ".agents", "state", "inbox"), "reviewer");
  assert.equal(mail.length, 1);
  assert.equal(mail[0]!.from, "coder");
  assert.match(mail[0]!.body, /\[CODE_READY\] branch=x/);
  // operator is the human's mailbox: mirror only, no runner to wake
  ctl(rig, "deliver", "operator", "--from", "orchestrator", "done");
  assert.equal(readNew(join(rig, ".agents", "state", "inbox"), "operator").length, 0);
  assert.match(readFileSync(join(rig, ".agents", "state", "inbox", "operator.md"), "utf8"), /done\n/);
});

test("emit: code_ready FANS OUT to reviewer AND tester mechanically (speed law — parallel verify, no relay turn)", () => {
  const rig = mkRig(CONC);
  emit(rig, "boot");
  assert.equal(emit(rig, "start_impl", "branch=feature/a").code, 0);
  git(rig, "checkout", "-qb", "feature/a");
  writeFileSync(join(rig, "f.txt"), "a\n");
  git(rig, "commit", "-qam", "a");
  const r = emit(rig, "code_ready", "branch=feature/a");
  assert.equal(r.code, 0);
  assert.match(r.out, /SIGNAL QUEUED for reviewer/);
  assert.match(r.out, /SIGNAL QUEUED for tester/);
  assert.doesNotMatch(r.out, /cmux/i, "no cmux transport lines survive T8");
  for (const seat of ["reviewer", "tester"] as const) {
    const mail = readNew(join(rig, ".agents", "state", "inbox"), seat);
    assert.equal(mail.length, 1, `${seat} auto-woken`);
    assert.match(mail[0]!.body, /\[CODE_READY\]/);
    assert.equal(mail[0]!.from, "orchestrator");
  }
});
