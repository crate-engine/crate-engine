import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enqueue, readNew } from "../src/mailbox.js";
import { runTurn, seatEnv, sessionFile } from "../src/runner.js";

// PHASE-8 T1: the seat runner. Driven with FAKE agents (stub scripts that
// emit claude-shaped streams) so the semantics are provable without tokens:
// complete-after-success, at-least-once on crash, timeout kills, session
// persistence. The live-adapter leg is the T1 scratch-rig proof.

const scratch = mkdtempSync(join(tmpdir(), "crate2-runner-"));

function makeProject(name: string): string {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state", "inbox"), { recursive: true });
  mkdirSync(join(proj, ".agents", "config"), { recursive: true });
  writeFileSync(join(proj, ".agents", "config", "reviewer.md"), "# binder");
  return proj;
}

function stub(proj: string, name: string, script: string): string {
  const p = join(proj, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${script}`);
  chmodSync(p, 0o755);
  return p;
}

const okStream = (sid: string) =>
  `echo '{"type":"system","subtype":"init"}'\n` +
  `echo '{"type":"result","subtype":"success","result":"done","session_id":"${sid}","usage":{"input_tokens":111,"output_tokens":22}}'\n`;

test("successful turn: mail completed (new/ empty), session + usage persisted, turn log written", async () => {
  const proj = makeProject("ok");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "reviewer", "orchestrator", "review it");
  const bin = stub(proj, "fake-ok.sh", okStream("sess-1"));
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, true);
  assert.equal(readNew(inbox, "reviewer").length, 0, "mail acked after success");
  assert.equal(JSON.parse(readFileSync(sessionFile(proj, "reviewer"), "utf8")).sessionId, "sess-1");
  assert.deepEqual(r.usage, { inputTokens: 111, outputTokens: 22 });
  const log = readFileSync(r.logPath!, "utf8");
  assert.match(log, /"type":"result"/); // raw stream captured verbatim
  assert.match(log, /"turnMeta"/); // meta line closes the log
});

test("failed turn (nonzero exit): mail REMAINS in new/ — at-least-once, clause 2", async () => {
  const proj = makeProject("fail");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "reviewer", "orchestrator", "review it");
  const bin = stub(proj, "fake-fail.sh", "echo boom >&2\nexit 1\n");
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, false);
  assert.equal(readNew(inbox, "reviewer").length, 1, "unacked mail survives the crash");
});

test("hung turn dies at the timeout and counts as failure (mail survives)", async () => {
  const proj = makeProject("hang");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "reviewer", "orchestrator", "review it");
  const bin = stub(proj, "fake-hang.sh", "sleep 60\n");
  const t0 = Date.now();
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude", turnTimeoutMs: 1500,
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 10_000, "killed at the timeout, not after 60s");
  assert.equal(readNew(inbox, "reviewer").length, 1);
});

test("second turn RESUMES the persisted session (sessionId rides the invocation)", async () => {
  const proj = makeProject("resume");
  const inbox = join(proj, ".agents", "state", "inbox");
  const seen: (string | undefined)[] = [];
  const bin = stub(proj, "fake-ok2.sh", okStream("sess-9"));
  for (const _ of [1, 2]) {
    enqueue(inbox, "reviewer", "orchestrator", "again");
    await runTurn({
      projectRoot: proj, seat: "reviewer", agent: "claude",
      invocationOverride: (_p, sid) => { seen.push(sid); return { argv: [bin], stdin: "ignore" }; },
    });
  }
  assert.deepEqual(seen, [undefined, "sess-9"], "turn 2 carries turn 1's session");
});

test("no mail → no turn (runTurn is a no-op that reports idle)", async () => {
  const proj = makeProject("idle");
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: () => { throw new Error("must not invoke"); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.idle, true);
});

test("the seat PATH carries the brain's core/tools shim (W4 finding #2 — headless P3-1 parity)", async () => {
  const proj = makeProject("seatpath");
  // a fake brain: .agents/bin symlinks into it, core/tools is the shim dir
  const brain = join(scratch, "seatpath-brain");
  mkdirSync(join(brain, "bin"), { recursive: true });
  mkdirSync(join(brain, "core", "tools"), { recursive: true });
  const { symlinkSync } = await import("node:fs");
  symlinkSync(join(brain, "bin"), join(proj, ".agents", "bin"));
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "reviewer", "orchestrator", "review it");
  const pathFile = join(proj, "seen-path.txt");
  const bin = stub(proj, "path-probe.sh", `echo "$PATH" > '${pathFile}'\n${okStream("s-path")}`);
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, true);
  const seen = readFileSync(pathFile, "utf8").trim();
  const { realpathSync } = await import("node:fs");
  assert.ok(seen.startsWith(join(realpathSync(brain), "core", "tools") + ":"),
    `seat PATH must lead with the tools shim — got: ${seen.slice(0, 120)}`);
});

test("every turn's child env carries CRATE_SEAT=<seat> (emit-identity fix — agentctl trusts this stamp)", async () => {
  const proj = makeProject("seatid");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "reviewer", "orchestrator", "review it");
  const seatFile = join(proj, "seen-seat.txt");
  const bin = stub(proj, "seat-probe.sh", `echo "$CRATE_SEAT" > '${seatFile}'\n${okStream("s-seat")}`);
  const r = await runTurn({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(seatFile, "utf8").trim(), "reviewer",
    "the harness child must see its seat's true identity");
});

test("seatEnv stamps CRATE_SEAT and OVERWRITES an inherited one (engine-nested-in-a-seat must not leak)", () => {
  const proj = makeProject("seatenv");
  assert.equal(seatEnv(proj, "coder").CRATE_SEAT, "coder");
  // spread-order proof: an outer CRATE_SEAT in the engine's own env must lose
  const had = "CRATE_SEAT" in process.env;
  const prev = process.env.CRATE_SEAT;
  process.env.CRATE_SEAT = "outer-seat";
  try {
    assert.equal(seatEnv(proj, "tester").CRATE_SEAT, "tester",
      "the seat's own identity wins over anything inherited");
  } finally {
    if (had) process.env.CRATE_SEAT = prev; else delete process.env.CRATE_SEAT;
  }
});

test("ack-only mail is ABSORBED without a turn (the courtesy-ack loop-breaker)", async () => {
  const proj = makeProject("ackloop");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "orchestrator", "coder", "Ack processed; state refreshed, still idle/standing by.");
  enqueue(inbox, "orchestrator", "coder", "Loop closed. No further action taken.");
  const r = await runTurn({
    projectRoot: proj, seat: "orchestrator", agent: "claude",
    invocationOverride: () => { throw new Error("an ack must NOT wake a turn"); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.idle, true);
  assert.equal(readNew(inbox, "orchestrator").length, 0, "acks are marked read (absorbed), not left to re-loop");
});

test("an OPERATOR message ALWAYS wakes a turn — even when it reads like an ack (W4 finding #4)", async () => {
  const proj = makeProject("opack");
  const inbox = join(proj, ".agents", "state", "inbox");
  // the live-caught shape: a directive whose tail ("hold nothing further")
  // matches the ack regex — from the operator it must still turn.
  enqueue(inbox, "orchestrator", "operator", "Proceed: merge the approved branch. Hold nothing further.");
  const bin = stub(proj, "opack.sh", okStream("s-op"));
  const r = await runTurn({
    projectRoot: proj, seat: "orchestrator", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.idle, true, "the operator's message was absorbed as an ack — it must wake a turn");
});

test("a REAL request still wakes a turn even alongside acks", async () => {
  const proj = makeProject("mixed");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "coder", "orchestrator", "Standing by.");
  enqueue(inbox, "coder", "orchestrator", "Build isEmpty(str) on branch feat/x and emit code_ready.");
  const bin = stub(proj, "ok3.sh", okStream("s3"));
  const r = await runTurn({
    projectRoot: proj, seat: "coder", agent: "claude",
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" }),
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.idle, true); // it DID turn (there was actionable work)
});
