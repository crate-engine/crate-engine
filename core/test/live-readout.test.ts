// 2c/2d — LIVE seat readout + durable operator chat (PDR
// dev/pdr/live-seat-readout.md, grilled 2026-07-25). Three layers proven:
// the stream render policy (words + beats, never output bodies, evidence on
// failure), the turn tailer (offset reads, partial-line hold, rollover
// seams, backlog replay), and the 2d gate semantics against the REAL
// agentctl (durable echo, engine-voiced mechanical ack, absorb-don't-
// duplicate on a repeat "merge go", multi-line mirror round-trip).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { streamEvent } from "../src/gui/teamview.js";
import { TurnTailHub, type TailEvent } from "../src/gui/turntail.js";
import { chatHistory, gateAlreadyReleased, mirrorNote, releaseGate, sendToOrchestrator } from "../src/gui/teamctl.js";
import { readNew } from "../src/mailbox.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-livereadout-"));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── the render policy ──

test("policy: agent text streams in full (deltas + final), thinking as its one-line summary", () => {
  const td = streamEvent(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Merged" } }));
  assert.deepEqual(td, { k: "td", t: "Merged" });
  const end = streamEvent(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "Merged the branch." } }));
  assert.deepEqual(end, { k: "text", t: "Merged the branch." });
  const think = streamEvent(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "**Planning the merge**" } }));
  assert.deepEqual(think, { k: "think", t: "Planning the merge" });
});

test("policy: toolcall arg deltas — the recorded noise — are dropped", () => {
  const ev = streamEvent(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: '{"' } }));
  assert.equal(ev, undefined);
});

test("policy: a tool call is a one-line beat with both flavors", () => {
  const ev = streamEvent(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } }));
  assert.equal(ev?.k, "tool");
  assert.equal(ev?.t, "$ npm test");
  assert.equal(ev?.p, "Running the tests");
});

test("policy: output bodies never render — honest fold on big, silence on small, evidence on failure", () => {
  const big = { type: "tool_execution_end", toolName: "bash", result: { content: [{ type: "text", text: Array.from({ length: 4012 }, (_, i) => `line ${i}`).join("\n") }] } };
  const fold = streamEvent(JSON.stringify(big));
  assert.equal(fold?.k, "fold");
  assert.equal(fold?.t, "… 4,012 lines of output");
  const small = { type: "tool_execution_end", toolName: "bash", result: { content: [{ type: "text", text: "ok\ndone" }] } };
  assert.equal(streamEvent(JSON.stringify(small)), undefined, "small successful output is silence");
  const failed = { type: "tool_execution_end", toolName: "bash", result: { isError: true, content: [{ type: "text", text: "one\ntwo\nthree\nfour\nError: ENOENT no such file\nnpm ERR! exit 1" }] } };
  const tail = streamEvent(JSON.stringify(failed));
  assert.equal(tail?.k, "errtail");
  assert.match(tail!.t, /ENOENT/);
  assert.match(tail!.t, /exit 1/);
  assert.ok(!tail!.t.includes("one"), "errtail keeps the LAST lines only");
  assert.equal(tail!.t.split("\n").length, 4);
});

test("policy: lifecycle chatter drops; turnMeta maps to the meta line; a replayed USER prompt never renders as agent speech", () => {
  for (const t of ["session", "agent_start", "turn_start", "message_start", "turn_end", "agent_end", "agent_settled", "tool_execution_update"]) {
    assert.equal(streamEvent(JSON.stringify({ type: t })), undefined, `${t} must drop`);
  }
  // pi message_end carries the USER prompt too — must never leak into the feed
  assert.equal(streamEvent(JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "secret inbox brief" }] } })), undefined);
  assert.equal(streamEvent(JSON.stringify({ type: "assistant", message: { role: "user", content: [{ type: "text", text: "user words" }] } })), undefined);
  const meta = streamEvent(JSON.stringify({ turnMeta: true, ok: true, durationMs: 63308, usage: { inputTokens: 847, outputTokens: 29 } }));
  assert.equal(meta?.k, "meta");
  assert.equal(meta?.ok, true);
  assert.match(meta!.t, /847→29 tok/);
});

// ── the tailer ──

function rigTurnsDir(rig: string, seat: string): string {
  const d = join(rig, ".agents", "state", "turns", seat);
  mkdirSync(d, { recursive: true });
  return d;
}

const textLine = (t: string): string => JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_end", content: t } }) + "\n";

test("tailer: streams new lines with ms-class lag, holds partial lines until their newline", async () => {
  const rig = join(scratch, "tail-live");
  const dir = rigTurnsDir(rig, "coder");
  const f = join(dir, "2026-07-25T10-00-00.000Z.jsonl");
  writeFileSync(f, textLine("already there"));
  const hub = new TurnTailHub(rig, 60);
  const got: TailEvent[] = [];
  const unsub = hub.subscribe((ev) => got.push(ev));
  try {
    await sleep(80);
    assert.equal(got.length, 0, "the hub starts at EOF — history is the backlog's job");
    appendFileSync(f, textLine("fresh words"));
    await sleep(150);
    assert.ok(got.some((e) => e.k === "text" && e.t === "fresh words" && e.seat === "coder"), `got: ${JSON.stringify(got)}`);
    // a partial line (no trailing newline) must NOT emit until completed
    const partial = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "held" } });
    appendFileSync(f, partial.slice(0, 30));
    await sleep(150);
    assert.ok(!got.some((e) => e.t === "held"), "half a line never renders");
    appendFileSync(f, partial.slice(30) + "\n");
    await sleep(150);
    assert.ok(got.some((e) => e.k === "text" && e.t === "held"), "the completed line arrives");
  } finally {
    unsub();
  }
});

test("tailer: a new turn file emits a seam and streams from offset zero", async () => {
  const rig = join(scratch, "tail-roll");
  const dir = rigTurnsDir(rig, "reviewer");
  writeFileSync(join(dir, "2026-07-25T10-00-00.000Z.jsonl"), textLine("old turn"));
  const hub = new TurnTailHub(rig, 60);
  const got: TailEvent[] = [];
  const unsub = hub.subscribe((ev) => got.push(ev));
  try {
    await sleep(80);
    writeFileSync(join(dir, "2026-07-25T11-00-00.000Z.jsonl"), textLine("new turn opens"));
    await sleep(200);
    const seam = got.find((e) => e.k === "seam" && e.seat === "reviewer");
    assert.ok(seam, "rollover emits a turn seam");
    assert.match(seam!.t, /2026-07-25T11:00:00/);
    assert.ok(got.some((e) => e.k === "text" && e.t === "new turn opens"));
  } finally {
    unsub();
  }
});

test("tailer: backlog replays recent turns seam-first (a client REPLACES its feed with this)", () => {
  const rig = join(scratch, "tail-backlog");
  const dir = rigTurnsDir(rig, "tester");
  writeFileSync(join(dir, "2026-07-25T09-00-00.000Z.jsonl"), textLine("turn one"));
  writeFileSync(join(dir, "2026-07-25T10-00-00.000Z.jsonl"),
    textLine("turn two") + JSON.stringify({ turnMeta: true, ok: true, durationMs: 5, usage: null }) + "\n");
  const hub = new TurnTailHub(rig, 60);
  const bl = hub.backlog();
  const tester = bl.filter((e) => e.seat === "tester");
  assert.equal(tester[0]?.k, "seam", "the feed opens on a turn seam");
  assert.deepEqual(tester.filter((e) => e.k === "text").map((e) => e.t), ["turn one", "turn two"]);
  assert.equal(tester.filter((e) => e.k === "seam").length, 2);
  assert.ok(tester.some((e) => e.k === "meta" && e.ok === true));
});

// ── 2d: durable echo + engine ack + absorb, against the REAL agentctl ──

function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "state", "inbox"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "bin"), { recursive: true });
  cpSync(join(ROOT, "bin", "agentctl.py"), join(rig, ".agents", "bin", "agentctl.py"));
  cpSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "rig.conf"), `PROJECT="${name}"\n`);
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  execFileSync("git", ["init", "-qb", "main"], { cwd: rig });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "root"], { cwd: rig, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  return rig;
}
function emit(rig: string, ...a: string[]): void {
  execFileSync("python3", [join(rig, ".agents", "bin", "agentctl.py"), "emit", ...a], { cwd: rig });
}

test("2d: merge go is durably echoed, engine-acked, and a repeat is ABSORBED (one [MERGE] order only)", () => {
  const rig = makeRig("gate-2d");
  emit(rig, "boot", "--actor", "orchestrator");
  emit(rig, "start_impl", "--actor", "coder");
  emit(rig, "code_ready", "--actor", "coder");
  emit(rig, "approved", "--actor", "orchestrator");
  assert.equal(gateAlreadyReleased(rig, "(single loop)"), false);

  const first = releaseGate(rig, "(single loop)", "merge go");
  assert.ok(first.ok, first.out);
  assert.equal(first.absorbed, undefined);
  assert.equal(gateAlreadyReleased(rig, "(single loop)"), true);

  // the operator's words are durably in the thread; the engine acked mechanically
  let hist = chatHistory(rig);
  assert.ok(hist.some((m) => m.from === "operator" && m.text === "merge go"), "durable echo");
  assert.ok(hist.some((m) => m.from === "engine" && /Merge released/.test(m.text)), "engine-voiced ack");

  // the repeat: absorbed — no second [MERGE] mail, an honest 'already released' ack
  const second = releaseGate(rig, "(single loop)", "merge go");
  assert.ok(second.ok);
  assert.equal(second.absorbed, true);
  const coderMail = readNew(join(rig, ".agents", "state", "inbox"), "coder");
  assert.equal(coderMail.filter((m) => m.body.startsWith("[MERGE]")).length, 1, "exactly ONE merge order");
  hist = chatHistory(rig);
  assert.equal(hist.filter((m) => m.from === "operator" && m.text === "merge go").length, 2, "both sends visible — nothing vanishes");
  assert.ok(hist.some((m) => m.from === "engine" && /Already released/.test(m.text)), "the repeat is acked honestly");

  // consumed by the merge: a THIRD release after deployed is refused by agentctl (not absorbed as released)
  emit(rig, "deployed", "--actor", "orchestrator");
  assert.equal(gateAlreadyReleased(rig, "(single loop)"), false, "deployed consumes the release");
});

test("2d: multi-line operator messages survive the mirror round-trip in full", () => {
  const rig = makeRig("chat-2d");
  const msg = "build the page\nwith a hero section\nand a footer";
  const r = sendToOrchestrator(rig, msg);
  assert.ok(r.ok, r.out);
  const hist = chatHistory(rig);
  const mine = hist.find((m) => m.from === "operator");
  assert.equal(mine?.text, msg, "all three lines survive");
  // and the mirror file itself stays line-oriented (one line per message)
  const mirror = readFileSync(join(rig, ".agents", "state", "inbox", "orchestrator.md"), "utf8").trimEnd();
  assert.equal(mirror.split("\n").length, 1);
});

test("2d: chatHistory reads the engine voice, mailbox-format lines, and mirrorNote writes", () => {
  const rig = join(scratch, "hist-2d");
  mkdirSync(join(rig, ".agents", "state", "inbox"), { recursive: true });
  mirrorNote(rig, "operator", "engine", "Merge released — the coder is merging the approved branch; DEPLOYED will confirm.");
  mirrorNote(rig, "operator", "orchestrator", "Deployed — the loop is closed.");
  // a mailbox.ts-flavored pipe line (the pre-unification format) still parses
  appendFileSync(join(rig, ".agents", "state", "inbox", "operator.md"), "2026-07-25T10:00:00.000Z | orchestrator | pipe-format line\n");
  const hist = chatHistory(rig);
  assert.ok(hist.some((m) => m.from === "engine" && /Merge released/.test(m.text)));
  assert.ok(hist.some((m) => m.from === "orchestrator" && m.text === "Deployed — the loop is closed."));
  assert.ok(hist.some((m) => m.from === "orchestrator" && m.text === "pipe-format line"));
});
