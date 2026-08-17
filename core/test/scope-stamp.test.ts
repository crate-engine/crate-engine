// CE-113 — the scope checkpoint stops being a 2-minute formality.
//
// P7-T4 made the coder send a FILE PLAN and wait for [SCOPE_OK], so a wrong
// scope is caught while it is still one message. But the stall guard let the
// coder self-authorize after ~2 minutes, and an orchestrator mid-turn is
// routinely quiet far longer — so the checkpoint almost never fired, and after
// the fact an approved plan and a timed-out one produced IDENTICAL logs.
//
// The cure is a record, not a wall: `scope_ok` is an always-legal event the
// orchestrator emits with its reply, and every code_ready stamps itself
// scope=ok or scope=unconfirmed from it. A wall would wedge any rig whose
// orchestrator has not learned the event yet; the value here is that a reviewer
// can SEE that the diff's scope was never approved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkRig(name: string): string {
  const rig = join(mkdtempSync(join(tmpdir(), "crate2-scope-")), name);
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
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

const log = (rig: string): string => readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
const codeReadyLines = (rig: string): string[] =>
  log(rig).split("\n").filter((l) => l.includes("CODE_READY"));

test("scope_ok is always-legal: it records without moving the loop's state", () => {
  const rig = mkRig("always");
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, "emit", "start_impl", "--actor", "coder");
  const before = ctl(rig, "state").out;
  const r = ctl(rig, "emit", "scope_ok", "--actor", "orchestrator");
  assert.equal(r.code, 0, `scope_ok must be legal mid-implementation: ${r.out}`);
  assert.match(log(rig), /SCOPE_OK actor=orchestrator/);
  assert.equal(ctl(rig, "state").out, before, "an always-event never moves state");
});

test("code_ready with a recorded scope_ok stamps scope=ok", () => {
  const rig = mkRig("ok");
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, "emit", "start_impl", "--actor", "coder");
  ctl(rig, "emit", "scope_ok", "--actor", "orchestrator");
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder");
  assert.equal(r.code, 0, r.out);
  assert.match(codeReadyLines(rig).at(-1)!, /scope=ok/);
});

test("code_ready with NO scope_ok stamps scope=unconfirmed — and says so out loud", () => {
  const rig = mkRig("unconfirmed");
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, "emit", "start_impl", "--actor", "coder");
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder");
  assert.equal(r.code, 0, "a missing scope_ok must NOT wedge the loop — it is a record, not a wall");
  assert.match(codeReadyLines(rig).at(-1)!, /scope=unconfirmed/);
  assert.match(r.out, /SCOPE UNCONFIRMED/);
});

test("a new round VOIDS last round's approval — re-approval is per round", () => {
  const rig = mkRig("rounds");
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, "emit", "start_impl", "--actor", "coder");
  ctl(rig, "emit", "scope_ok", "--actor", "orchestrator");
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  assert.match(codeReadyLines(rig).at(-1)!, /scope=ok/, "round 1 was approved");
  // round 2: rework, no fresh plan approval
  ctl(rig, "emit", "changes_needed", "--actor", "orchestrator");
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  assert.match(
    codeReadyLines(rig).at(-1)!,
    /scope=unconfirmed/,
    "round 1's scope_ok must not vouch for round 2's plan",
  );
  // round 3: approved again
  ctl(rig, "emit", "changes_needed", "--actor", "orchestrator");
  ctl(rig, "emit", "scope_ok", "--actor", "orchestrator");
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  assert.match(codeReadyLines(rig).at(-1)!, /scope=ok/);
});

test("doctrine pins: the stall LADDER replaced the 2-minute self-start (CE-113)", () => {
  const coder = readFileSync(join(ROOT, "config", "coder.md"), "utf8");
  assert.match(coder, /Stall LADDER/, "the ladder is named");
  assert.match(coder, /RESEND the plan once/, "rung 1: resend, because mail gets eaten");
  assert.match(coder, /NARROWEST reading/, "rung 2: narrowest slice, not the full declared plan");
  assert.doesNotMatch(
    coder,
    /within ~2 minutes, proceed exactly per your stated plan/,
    "the old 2-minute self-start must be gone, not merely amended",
  );
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(orch, /emit scope_ok --actor\s+orchestrator/, "the orchestrator is told to RECORD it");
  assert.match(orch, /A resend is not a duplicate to\s+ignore/, "a resend means the ack never landed");
  const sm = readFileSync(join(ROOT, "config", "state-machine.yaml"), "utf8");
  assert.match(sm, /^always_legal:.*\bscope_ok\b/m, "scope_ok is always-legal in the shipped machine");
});

// ── CE-103: a queued mail is durable; a READER is a separate claim ──────────
// `deliver` printed "QUEUED: <role>'s runner wakes on it" unconditionally, so a
// dispatch to a seat with no runner at all read as a success and the sender
// waited on a reply nobody would ever send. The maildir IS durable, so the cure
// is honesty about the second half of that sentence, not a refusal to queue.
test("deliver to a seat that has NEVER run warns it reached nobody (CE-103)", () => {
  const rig = mkRig("ce103-never");
  const r = ctl(rig, "deliver", "reviewer", "please review feat/x");
  assert.equal(r.code, 0, "still queues — durability is not the defect");
  assert.match(r.out, /QUEUED for reviewer: state\/inbox\/reviewer\/new\/.+ — durable/);
  assert.match(r.out, /WARNING — NOT DELIVERED TO ANYONE YET/);
  assert.match(r.out, /no runner has EVER taken a turn as this seat/);
  assert.match(r.out, /do NOT|staff the seat/, "and says what to do instead of waiting");
});

test("deliver to a seat with a recent turn reports that, with no warning (CE-103)", () => {
  const rig = mkRig("ce103-recent");
  mkdirSync(join(rig, ".agents", "state", "turns", "coder"), { recursive: true });
  writeFileSync(join(rig, ".agents", "state", "turns", "coder", "turns.log"), "a turn\n");
  const r = ctl(rig, "deliver", "coder", "[MERGE] go");
  assert.match(r.out, /coder: last turn \d+ min ago/);
  assert.doesNotMatch(r.out, /NOT DELIVERED TO ANYONE YET/);
});

test("a seat idle for hours gets the softer note, not a false all-clear (CE-103)", () => {
  const rig = mkRig("ce103-stale");
  const t = join(rig, ".agents", "state", "turns", "coder");
  mkdirSync(t, { recursive: true });
  const log = join(t, "turns.log");
  writeFileSync(log, "an old turn\n");
  const old = new Date(Date.now() - 40 * 3600 * 1000);
  utimesSync(log, old, old);
  const r = ctl(rig, "deliver", "coder", "still there?");
  assert.match(r.out, /NOTE: coder \(last turn \d+\.\d h ago/);
  assert.match(r.out, /waits indefinitely/);
});
