import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { acquireConsumerLease } from "../src/consumer-lease.js";
import { complete, enqueue, readNew } from "../src/mailbox.js";
import { readWork, resolveWork, saveWork, type WorkRecord } from "../src/work-recovery.js";
import { runTurn, runnerLoop, sessionFile } from "../src/runner.js";
import { reconcileBlendedRestart, sessionWorkState } from "../src/blend.js";

const root = () => realpathSync(mkdtempSync(join(tmpdir(), "crate-recovery-")));
const inbox = (p: string) => join(p, ".agents", "state", "inbox");
async function until(f: () => boolean): Promise<void> {
  const end = Date.now() + 6000;
  while (!f()) { if (Date.now() > end) throw new Error("condition timed out"); await new Promise(r => setTimeout(r, 20)); }
}
function nodeChild(code: string, p: string): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, p], { stdio: ["ignore", "pipe", "pipe"] });
}
test("kernel lease excludes another process and path alias, then releases after owner SIGKILL", async () => {
  const p = root(), alias = p + "-alias";
  symlinkSync(p, alias);
  const child = nodeChild(`import { acquireConsumerLease } from './src/consumer-lease.ts'; await acquireConsumerLease(process.argv[1], 'coder'); console.log('ready');`, p);
  let ready = false;
  child.stdout!.on("data", () => { ready = true; });
  try {
    await until(() => ready);
    await assert.rejects(acquireConsumerLease(alias, "coder"), /another consumer/);
    const other = await acquireConsumerLease(p, "reviewer"); await other.release();
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const successor = await acquireConsumerLease(p, "coder", 2000); await successor.release();
  } finally { child.kill("SIGKILL"); }
});
test("headless failure after a side effect preserves work and does not auto-replay", async () => {
  const p = root(); enqueue(inbox(p), "coder", "operator", "make one change");
  const counter = join(p, "effects");
  const opts = { projectRoot: p, seat: "coder", agent: "claude", invocationOverride: () => ({ argv: [process.execPath, "-e", `require('fs').appendFileSync(${JSON.stringify(counter)},'x'); process.exit(1)`], stdin: "ignore" as const }) };
  assert.equal((await runTurn(opts)).recoveryRequired, true);
  assert.equal((await runTurn(opts)).recoveryRequired, true);
  assert.equal(readFileSync(counter, "utf8"), "x");
  assert.equal(readNew(inbox(p), "coder").length, 1);
  await resolveWork(p, "coder", "retry", "Verified failed operation can safely run again");
  await runTurn(opts);
  assert.equal(readFileSync(counter, "utf8"), "xx");
});
test("SIGKILL during a real headless turn leaves durable evidence; replacement never repeats it", async () => {
  const p = root(); enqueue(inbox(p), "coder", "operator", "long operation");
  const counter = join(p, "effects");
  const child = nodeChild(`import { runTurn } from './src/runner.ts'; await runTurn({ projectRoot: process.argv[1], seat:'coder', agent:'claude', invocationOverride:()=>({argv:[process.execPath,'-e',${JSON.stringify(`require('fs').appendFileSync(${JSON.stringify(counter)},'x');setTimeout(()=>{},60000)`)}],stdin:'ignore'}) });`, p);
  let workPid: number | undefined;
  try {
    await until(() => existsSync(counter)); workPid = readWork(p, "coder")?.pid;
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const lease = await acquireConsumerLease(p, "coder", 2000);
    const r = await runTurn({ projectRoot: p, seat: "coder", agent: "claude", consumerLease: lease, invocationOverride: () => { throw new Error("must never replay"); } });
    await lease.release();
    assert.equal(r.recoveryRequired, true); assert.equal(readFileSync(counter, "utf8"), "x");
    await assert.rejects(resolveWork(p, "coder", "retry", "inspection"), /still alive/);
  } finally { child.kill("SIGKILL"); if (workPid) { try { process.kill(-workPid, "SIGKILL"); } catch {} } }
});
test("a recovery hold keeps the consumer owned until operator stop", async () => {
  const p = root(), ac = new AbortController(); let calls = 0;
  const loop = runnerLoop({ projectRoot: p, seat: "coder", agent: "claude", signal: ac.signal, pollMs: 10,
    runTurnImpl: async () => { calls++; return { ok: false, recoveryRequired: true, error: "inspect" }; } });
  try { await until(() => calls > 0); await assert.rejects(acquireConsumerLease(p, "coder"), /another consumer/); assert.equal(calls, 1); }
  finally { ac.abort(); await loop; }
});
function blendedFixture() {
  const p = root(), home = join(p, "home"), id = "aa11bb22";
  const dir = join(home, ".claude", "projects", p.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(dir, { recursive: true });
  const path = join(dir, "known-session.jsonl");
  writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: `[team mail #${id}]` } }) + "\n");
  enqueue(inbox(p), "coder", "operator", "work");
  const record: WorkRecord = { version: 1, mode: "blended", agent: "claude", phase: "prepared", id, messages: readNew(inbox(p), "coder").map(m => m.name), at: new Date().toISOString() };
  saveWork(p, "coder", record);
  return { p, home, path, record };
}
test("restart reconciles receipt but holds incomplete work; explicit resume preserves exact session once", async () => {
  const { p, home, path } = blendedFixture();
  assert.throws(() => reconcileBlendedRestart(p, "coder", "claude", home), /unfinished work/);
  assert.equal(readNew(inbox(p), "coder").length, 0);
  assert.equal(readWork(p, "coder")?.phase, "received");
  rmSync(sessionFile(p, "coder"));
  await resolveWork(p, "coder", "resume", "Confirmed receipt; continue from the existing session after inspecting changes");
  assert.equal(JSON.parse(readFileSync(sessionFile(p, "coder"), "utf8")).sessionId, "known-session");
  reconcileBlendedRestart(p, "coder", "claude", home);
  assert.equal(readWork(p, "coder")?.resumeApproved, false);
  assert.throws(() => reconcileBlendedRestart(p, "coder", "claude", home), /unfinished work/);
  appendFileSync(path, JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn" } }) + "\n");
  reconcileBlendedRestart(p, "coder", "claude", home);
  assert.equal(readWork(p, "coder"), undefined);
});
test("explicit retry requeues only original received mail; later messages remain intact", async () => {
  const { p, record } = blendedFixture(); complete(inbox(p), "coder", readNew(inbox(p), "coder"));
  saveWork(p, "coder", { ...record, phase: "received" }); enqueue(inbox(p), "coder", "reviewer", "later");
  await resolveWork(p, "coder", "retry", "effects checked; replay approved");
  const names = readNew(inbox(p), "coder").map(m => m.name);
  assert.equal(names.length, 2); assert.ok(names.includes(record.messages[0]!)); assert.equal(readWork(p, "coder"), undefined);
});
test("quiet tools and malformed tails do not prove completion; provider completion does", () => {
  assert.equal(sessionWorkState('{"type":"assistant","message":{"stop_reason":"tool_use"}}\n', "claude"), "busy");
  assert.equal(sessionWorkState('{"type":"assistant","message":{"stop_reason":"end_turn"}}\n', "claude"), "idle");
  assert.equal(sessionWorkState('{"type":"message","message":{"role":"assistant","stopReason":"toolUse"}}\n', "pi"), "busy");
  assert.equal(sessionWorkState('{"type":"message","message":{"role":"assistant","stopReason":"stop"}}\n', "pi"), "idle");
  assert.equal(sessionWorkState('{"type":"event_msg","payload":{"type":"task_complete"}}\n{"type":', "codex"), "unknown");
});
