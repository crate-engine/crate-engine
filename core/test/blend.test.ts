// THE BLENDED PANE — S1 transport, the pure/fs-faked legs. House pattern:
// mkdtemp scratch projects, in-memory fakes, injectable seams. The live PTY
// leg (injected mail lands while a human types, never clobbered) is the S1
// gate proof, not mocked here.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assistantTurnStartedAfter,
  blendEligible,
  blendedTurn,
  CLI_DELIVERY,
  codexRolloutMatches,
  codexSessionIdOf,
  claudeTrustHandshake,
  codexTrustHandshake,
  composerQuiet,
  createStaleTracker,
  deliverToBlendedSeat,
  findBlendSession,
  findBlendSessionCandidates,
  findCodexRollout,
  isBlended,
  isTaskEndEvent,
  needsClaudeTrustAnswer,
  needsTrustAnswer,
  newDeliveryId,
  persistOverridden,
  piSessionsDir,
  renderMailBlock,
  renderOrientation,
  seatsToReset,
  sessionOriented,
  sessionUsage,
  taskEndsIn,
  verifyDelivered,
  watchForEarlyStop,
  watchTaskEnds,
  type BlendTtyHandle,
} from "../src/blend.js";
import { updateComposerDirty, pickPiNodeVersion } from "../src/ptyseat.js";
import { parseRigConf } from "../src/staffing.js";
import { enqueue, readNew, type Message } from "../src/mailbox.js";
import { attendedFile, runnerLoop, sessionFile } from "../src/runner.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-blend-"));

function makeProject(name: string): string {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state", "inbox"), { recursive: true });
  return proj;
}

function msg(from: string, body: string, at = "2026-08-12T01:00:00.000Z"): Message {
  return { path: "/nowhere", name: "0-0-0.msg", at, from, body };
}

// instant fake sleep that still yields the microtask queue
const noSleep = async (_ms: number) => {};

// ── flags ──

test("isBlended: BLEND_<PREFIX>=1 via parseRigConf; default OFF", () => {
  const conf = parseRigConf('BLEND_CODER=1\nBLEND_ORCH="1"\nBLEND_TESTER=0\n');
  assert.equal(isBlended(conf, "coder"), true);
  assert.equal(isBlended(conf, "orchestrator"), true, "quoted value parses to 1");
  assert.equal(isBlended(conf, "tester"), false, "explicit 0 is off");
  assert.equal(isBlended(conf, "reviewer"), false, "absent is off — defaults stay OFF tonight");
});

test("persistOverridden: BLEND_<PREFIX>_PERSIST=1 (the Q1 safety valve)", () => {
  const conf = parseRigConf("BLEND_REVIEWER_PERSIST=1\n");
  assert.equal(persistOverridden(conf, "reviewer"), true);
  assert.equal(persistOverridden(conf, "coder"), false);
});

test("blendEligible: claude/pi/codex live-probed; anything else refuses in plain words", () => {
  assert.deepEqual(blendEligible("claude"), { ok: true, cli: "claude" });
  assert.deepEqual(blendEligible("claude-code"), { ok: true, cli: "claude" }, "alias normalizes");
  assert.deepEqual(blendEligible("pi"), { ok: true, cli: "pi" });
  assert.deepEqual(blendEligible("codex"), { ok: true, cli: "codex" });
  const r = blendEligible("aider");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /headless runner path/, "fail-open to the proven path, stated honestly");
});

// ── rendering ──

test("renderMailBlock: id header, every message's at/from/body, newlines preserved, no control chars", () => {
  const block = renderMailBlock(
    [msg("orchestrator", "line one\nline two survives"), msg("reviewer", "second message")],
    "abcd1234",
  );
  assert.match(block, /^\[team mail #abcd1234 — engine delivery, not the operator\]\n/);
  assert.match(block, /\[2026-08-12T01:00:00\.000Z\] from orchestrator: line one\nline two survives/);
  assert.match(block, /from reviewer: second message/);
  assert.ok(!/[\r\x1b\x03]/.test(block), "submit + paste-wrap are the injector's job, never the renderer's");
});

test("renderMailBlock: redelivery header makes the duplicate visible + ignorable", () => {
  const block = renderMailBlock([msg("coder", "x")], "abcd1234", true);
  assert.match(block, /^\[team mail #abcd1234 — REDELIVERY; ignore if already received\]/);
});

test("newDeliveryId: 8 hex chars", () => {
  assert.match(newDeliveryId(), /^[0-9a-f]{8}$/);
});

// ── composer state + quiet gate ──

test("updateComposerDirty: printables dirty; CR/Esc/Ctrl+C clear; CSI arrows are not typing", () => {
  assert.equal(updateComposerDirty(false, Buffer.from("h")), true);
  assert.equal(updateComposerDirty(true, Buffer.from("\r")), false, "submit empties the composer");
  assert.equal(updateComposerDirty(true, Buffer.from("\x1b")), false, "Esc cancels the draft");
  assert.equal(updateComposerDirty(true, Buffer.from("\x03")), false, "Ctrl+C clears");
  assert.equal(updateComposerDirty(false, Buffer.from("\x1b[A")), false, "arrow key is cursor motion, not a draft");
  assert.equal(updateComposerDirty(false, Buffer.from("abc\r")), false, "typed then submitted within one chunk = clean");
  assert.equal(updateComposerDirty(false, Buffer.from("\rabc")), true, "submitted then typed again = dirty");
});

test("composerQuiet: never-typed is quiet; clean composer needs the short window; dirty demands the LONG quiet", () => {
  assert.equal(composerQuiet({ lastHumanInputMs: undefined, composerDirty: false }, 1000), true);
  assert.equal(composerQuiet({ lastHumanInputMs: 10_000, composerDirty: false }, 10_100), false, "typed 100ms ago");
  assert.equal(composerQuiet({ lastHumanInputMs: 10_000, composerDirty: false }, 13_000), true, "exactly the window");
  assert.equal(
    composerQuiet({ lastHumanInputMs: 10_000, composerDirty: true }, 20_000),
    false,
    "half-typed draft: our CR would submit it with the mail — wait the long quiet",
  );
  assert.equal(composerQuiet({ lastHumanInputMs: 10_000, composerDirty: true }, 40_000), true);
});

// ── session-file discovery ──

test("piSessionsDir matches the live-probed munge (/ → -, wrapped in --…--)", () => {
  assert.equal(
    piSessionsDir("/home/adam-duguay/scratch/blend-probe/pi-wd", "/home/adam-duguay"),
    "/home/adam-duguay/.pi/agent/sessions/--home-adam-duguay-scratch-blend-probe-pi-wd--",
  );
});

test("codex rollout matcher: session_meta cwd match + session id extraction", () => {
  const meta = JSON.stringify({ type: "session_meta", payload: { session_id: "sid-77", cwd: "/rig/a" } });
  assert.equal(codexRolloutMatches(meta, "/rig/a"), true);
  assert.equal(codexRolloutMatches(meta, "/rig/b"), false);
  assert.equal(codexRolloutMatches("not json", "/rig/a"), false);
  assert.equal(codexSessionIdOf(meta), "sid-77");
});

test("findCodexRollout: date-tree scan, mtime-gated, cwd-matched", () => {
  const home = join(scratch, "codex-home");
  const since = Date.now() - 60_000; // spawn a minute ago; fixtures written "now" qualify
  const d = new Date(since);
  const day = join(home, ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  mkdirSync(day, { recursive: true });
  const mine = join(day, "rollout-2026-08-12T01-00-01-aaa.jsonl");
  writeFileSync(mine, JSON.stringify({ type: "session_meta", payload: { session_id: "s1", cwd: "/rig/mine" } }) + "\n");
  const other = join(day, "rollout-2026-08-12T01-00-02-bbb.jsonl");
  writeFileSync(other, JSON.stringify({ type: "session_meta", payload: { session_id: "s2", cwd: "/rig/other" } }) + "\n");
  const old = join(day, "rollout-2026-08-12T00-00-00-ccc.jsonl");
  writeFileSync(old, JSON.stringify({ type: "session_meta", payload: { session_id: "s0", cwd: "/rig/mine" } }) + "\n");
  utimesSync(old, new Date(since - 3600_000), new Date(since - 3600_000));
  assert.equal(findCodexRollout(home, "/rig/mine", since), mine, "newest matching rollout since spawn wins");
  assert.equal(findCodexRollout(home, "/rig/nowhere", since), undefined);
});

test("findBlendSession (pi): newest jsonl in the munged dir; uuid parsed from the filename", async () => {
  const home = join(scratch, "pi-home");
  const cwd = join(scratch, "pi-rig");
  mkdirSync(cwd, { recursive: true });
  // pi keys by the REAL cwd (macOS tmpdir hides behind /private) — mirror it
  const { realpathSync } = await import("node:fs");
  const dir = piSessionsDir(realpathSync(cwd), home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-08-12T00-18-00-959Z_uuid-abc.jsonl"), "{}\n");
  const found = findBlendSession("pi", { projectRoot: cwd, home, sinceMs: 0 });
  assert.ok(found);
  assert.equal(found.sessionId, "uuid-abc");
  assert.match(found.path, /uuid-abc\.jsonl$/);
});

// ── verification (the user-only filter is load-bearing) ──

const claudeUser = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: text }, origin: { kind: "human" } });
const claudeUserParts = (text: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const claudeAssistant = (text: string) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

test("verifyDelivered (claude): user string content and content-array both hit", () => {
  assert.equal(verifyDelivered(claudeUser("[team mail #ab12cd34 — engine delivery]\nbody"), "#ab12cd34", "claude"), true);
  assert.equal(verifyDelivered(claudeUserParts("hello #ab12cd34"), "#ab12cd34", "claude"), true);
});

test("verifyDelivered (claude): an assistant echo of the marker is NOT a delivery", () => {
  const jsonl = claudeAssistant("I received #ab12cd34 and will act") + "\n";
  assert.equal(verifyDelivered(jsonl, "#ab12cd34", "claude"), false);
});

test("verifyDelivered: malformed + partial trailing lines tolerated; empty file false", () => {
  const jsonl = "not-json\n" + claudeUser("mail #ab12cd34") + "\n" + '{"type":"user","message":{"role":"u';
  assert.equal(verifyDelivered(jsonl, "#ab12cd34", "claude"), true);
  assert.equal(verifyDelivered("", "#x", "claude"), false);
});

test("verifyDelivered (pi): type=message role=user text part (probed shape)", () => {
  const line = JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "mail #dd11ee22" }] } });
  assert.equal(verifyDelivered(line, "#dd11ee22", "pi"), true);
  const assistant = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "#dd11ee22" }] } });
  assert.equal(verifyDelivered(assistant, "#dd11ee22", "pi"), false);
});

test("verifyDelivered (codex): both probed shapes hit; assistant/event noise does not", () => {
  const eventMsg = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "mail #ff00aa11" } });
  const respItem = JSON.stringify({ type: "response_item", payload: { role: "user", content: [{ type: "input_text", text: "mail #ff00aa11" }] } });
  const noise = JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "#ff00aa11" } });
  assert.equal(verifyDelivered(eventMsg, "#ff00aa11", "codex"), true);
  assert.equal(verifyDelivered(respItem, "#ff00aa11", "codex"), true);
  assert.equal(verifyDelivered(noise, "#ff00aa11", "codex"), false);
});

// ── session usage (honest degrade) ──

test("sessionUsage: last assistant usage wins; tokens = input + cache_read; absent → undefined", () => {
  const jsonl =
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } } }) +
    "\n" +
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 20, cache_read_input_tokens: 180, output_tokens: 7 } } }) +
    "\n";
  assert.deepEqual(sessionUsage(jsonl), { inputTokens: 200, outputTokens: 7 });
  assert.equal(sessionUsage(claudeUser("no usage here")), undefined, "no usage → NO gauge, never a fake 0%");
  assert.equal(sessionUsage(""), undefined);
});

// ── the delivery writer ──

interface FakeTty extends BlendTtyHandle {
  injected: string[];
}
function fakeTty(over: Partial<BlendTtyHandle> = {}): FakeTty {
  const t: FakeTty = {
    injected: [],
    composerDirty: false,
    inject(d) {
      t.injected.push(typeof d === "string" ? d : d.toString("utf8"));
    },
    ...over,
  } as FakeTty;
  return t;
}

test("deliverToBlendedSeat: paste-wrap then a SEPARATE CR; verified first try → ok, one attempt", async () => {
  const tty = fakeTty();
  let session = "";
  const sleeps: number[] = [];
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "build the thing")],
    cli: "claude",
    readSession: () => session,
    sleep: async (ms) => {
      sleeps.push(ms);
      // the CLI "writes" the session file once the paste+CR happened
      if (tty.injected.includes("\r")) {
        const idHeader = tty.injected[0]!.match(/#([0-9a-f]{8})/)![1]!;
        session = claudeUser(`[team mail #${idHeader} …]\nbuild the thing`);
      }
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(tty.injected.length, 2, "one paste write + one CR write");
  assert.match(tty.injected[0]!, /^\x1b\[200~\[team mail #[0-9a-f]{8} — engine delivery/, "bracketed paste opens");
  assert.match(tty.injected[0]!, /\x1b\[201~$/, "…and closes around the block");
  assert.ok(!tty.injected[0]!.includes("\r"), "the CR is never inside the paste (codex swallow law)");
  assert.equal(tty.injected[1], "\r");
  assert.equal(sleeps[0], 1000, "the submit gap precedes the CR");
});

test("deliverToBlendedSeat: miss → ONE redelivery (visible header) → verified on attempt 2", async () => {
  const tty = fakeTty();
  let session = "";
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "again")],
    cli: "claude",
    readSession: () => session,
    verifyTimeoutMs: 10,
    verifyPollMs: 1,
    sleep: async () => {
      // land the marker only after the SECOND paste (the redelivery)
      const pastes = tty.injected.filter((s) => s.startsWith("\x1b[200~"));
      if (pastes.length === 2) {
        const id = pastes[1]!.match(/#([0-9a-f]{8})/)![1]!;
        session = claudeUser(`got #${id}`);
      }
    },
    now: Date.now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  const pastes = tty.injected.filter((s) => s.startsWith("\x1b[200~"));
  assert.equal(pastes.length, 2);
  assert.match(pastes[1]!, /REDELIVERY; ignore if already received/, "the duplicate is visible + ignorable (D11)");
});

test("deliverToBlendedSeat: a LATE landing before the redelivery is caught — no duplicate paste", async () => {
  const tty = fakeTty();
  let session = "";
  let sleepCount = 0;
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "slow turn")],
    cli: "pi",
    readSession: () => session,
    verifyTimeoutMs: 5,
    verifyPollMs: 1,
    sleep: async () => {
      // the pi turn ends (and the file gains the line) AFTER attempt 1's
      // verify window closed but BEFORE attempt 2 pastes
      if (++sleepCount === 8) {
        const id = tty.injected[0]!.match(/#([0-9a-f]{8})/)![1]!;
        session = JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: `#${id}` }] } });
      }
    },
    now: Date.now,
  });
  assert.equal(r.ok, true);
  assert.equal(tty.injected.filter((s) => s.startsWith("\x1b[200~")).length, 1, "no needless second paste");
});

test("deliverToBlendedSeat: never verified → honest failure after exactly 2 attempts", async () => {
  const tty = fakeTty();
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "into the void")],
    cli: "claude",
    readSession: () => "",
    verifyTimeoutMs: 5,
    verifyPollMs: 1,
    sleep: noSleep,
    now: Date.now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2);
  assert.match(r.error!, /not verified in session file after 2 attempts/);
  assert.equal(tty.injected.filter((s) => s.startsWith("\x1b[200~")).length, 2);
});

test("deliverToBlendedSeat: waits for a quiet composer before injecting (the engine yields to the human)", async () => {
  let nowMs = 100_000;
  const tty = fakeTty({ lastHumanInputMs: 99_900, composerDirty: false }); // typed 100ms ago
  let session = "";
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "wait your turn")],
    cli: "claude",
    readSession: () => session,
    quietMs: 3000,
    quietPollMs: 100,
    verifyPollMs: 1,
    sleep: async (ms) => {
      assert.equal(tty.injected.length === 0 || nowMs - 99_900 >= 3000, true, "nothing injected while the human is fresh on the keys");
      nowMs += ms;
      if (tty.injected.includes("\r")) {
        const id = tty.injected[0]!.match(/#([0-9a-f]{8})/)![1]!;
        session = claudeUser(`#${id}`);
      }
    },
    now: () => nowMs,
  });
  assert.equal(r.ok, true);
  assert.ok(nowMs >= 99_900 + 3000, "delivery happened only after the quiet window elapsed");
});

// ── fresh-per-task reset ──

test("isTaskEndEvent/taskEndsIn: CLOSE/ABANDON/RESEARCH_DONE end a task; REJECTED and opens do not", () => {
  assert.equal(isTaskEndEvent("[2026-08-12T01:00:00Z] CLOSE actor=orchestrator task=feat/x state=idle"), true);
  assert.equal(isTaskEndEvent("[2026-08-12T01:00:00Z] ABANDON actor=orchestrator reason=\"bad brief\" state=idle"), true);
  assert.equal(isTaskEndEvent("[2026-08-12T01:00:00Z] RESEARCH_DONE actor=orchestrator state=idle"), true);
  assert.equal(isTaskEndEvent("[2026-08-12T01:00:00Z] START_IMPL actor=orchestrator state=implementing"), false);
  assert.equal(isTaskEndEvent("[2026-08-12T01:00:00Z] REJECTED event=close actor=coder reason=illegal_from=idle"), false);
  assert.equal(taskEndsIn("[t] CLOSE a state=idle\n[t] START_IMPL b state=implementing\n[t] ABANDON c state=idle\n"), 2);
});

test("seatsToReset: workers only — orchestrator persists; per-seat persist override honored", () => {
  const conf = parseRigConf("BLEND_REVIEWER_PERSIST=1\n");
  assert.deepEqual(
    seatsToReset(["orchestrator", "coder", "reviewer", "tester"], conf),
    ["coder", "tester"],
    "orchestrator exempt by law, reviewer exempt by override",
  );
});

test("watchTaskEnds: only NEW task-end events fire; history at boot is not a boundary", async () => {
  const proj = makeProject("watch");
  const log = join(proj, ".agents", "state", "events.log");
  writeFileSync(log, "[t0] CLOSE actor=orchestrator state=idle\n"); // history — must NOT fire
  let fired = 0;
  const unwatch = watchTaskEnds(proj, () => fired++, { pollMs: 20 });
  try {
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(fired, 0, "pre-existing history ignored");
    appendFileSync(log, "[t1] START_IMPL actor=orchestrator state=implementing\n");
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(fired, 0, "a task OPEN is not a boundary");
    appendFileSync(log, "[t2] CLOSE actor=orchestrator task=feat/y state=idle\n");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fired, 1, "the close fires the reset marker");
  } finally {
    unwatch();
  }
});

// ── codex trust handshake ──

test("needsTrustAnswer + codexTrustHandshake: dialog answered '1'+CR; no dialog → false, no injection", async () => {
  assert.equal(needsTrustAnswer("… Do you trust the contents of this directory? …"), true);
  assert.equal(needsTrustAnswer("plain composer"), false);
  const tty = fakeTty();
  let replay = "booting…";
  setTimeout(() => (replay = "Do you trust the contents of this directory?"), 5);
  const answered = await codexTrustHandshake(() => replay, tty, { timeoutMs: 500, pollMs: 5 });
  assert.equal(answered, true);
  assert.deepEqual(tty.injected, ["1", "\r"]);

  const quietTty = fakeTty();
  const none = await codexTrustHandshake(() => "already trusted", quietTty, { timeoutMs: 20, pollMs: 5 });
  assert.equal(none, false);
  assert.deepEqual(quietTty.injected, [], "no dialog → nothing injected (already-trusted dir)");
});

test("needsClaudeTrustAnswer + claudeTrustHandshake: the folder-trust dialog is answered with a bare CR; needle survives cursor-forward spacing", async () => {
  // literal-space render
  assert.equal(needsClaudeTrustAnswer("… ❯ 1. Yes, I trust this folder … 2. No, exit"), true);
  // live-pane render: spacing drawn as CSI cursor-forward, no literal spaces (proof rig, 2026-08-12)
  assert.equal(needsClaudeTrustAnswer("Yes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder"), true);
  assert.equal(needsClaudeTrustAnswer("Is this a project you created or one you trust?"), true);
  // the bypass-permissions warning (default: "No, exit") must NEVER match — a blind CR there would kill the pane
  assert.equal(needsClaudeTrustAnswer("WARNING: Claude Code running in Bypass Permissions mode … 1. No, exit  2. Yes, I accept"), false);
  assert.equal(needsClaudeTrustAnswer("plain composer"), false);
  const tty = fakeTty();
  let replay = "booting…";
  setTimeout(() => (replay = "❯ 1. Yes, I trust this folder"), 5);
  const answered = await claudeTrustHandshake(() => replay, tty, { timeoutMs: 500, pollMs: 5 });
  assert.equal(answered, true);
  assert.deepEqual(tty.injected, ["\r"], "bare CR — option 1 is preselected");
  const quietTty = fakeTty();
  const none = await claudeTrustHandshake(() => "already trusted", quietTty, { timeoutMs: 20, pollMs: 5 });
  assert.equal(none, false);
  assert.deepEqual(quietTty.injected, [], "no dialog → nothing injected");
});

// ── the blended turn (mailbox semantics with in-memory fakes) ──

interface TurnRig {
  proj: string;
  inbox: string;
  tty: FakeTty;
  session: { text: string };
  events: string[];
  opts: Parameters<typeof blendedTurn>[0];
}

function turnRig(name: string, over: Partial<Parameters<typeof blendedTurn>[0]> = {}): TurnRig {
  const proj = makeProject(name);
  const inbox = join(proj, ".agents", "state", "inbox");
  const tty = fakeTty();
  const session = { text: "" };
  const events: string[] = [];
  const rig: TurnRig = {
    proj,
    inbox,
    tty,
    session,
    events,
    opts: {
      projectRoot: proj,
      seat: "coder",
      cli: "claude",
      agentArg: "claude",
      getTty: () => {
        events.push("getTty");
        return tty;
      },
      respawn: async (reason) => {
        events.push(`respawn:${reason}`);
        return tty;
      },
      readSession: () => session.text,
      currentSessionId: () => "sess-blend-1",
      stale: createStaleTracker(),
      spawnSettleMs: 0,
      verifyTimeoutMs: 10,
      verifyPollMs: 1,
      sleep: async () => {
        events.push("sleep");
        if (tty.injected.includes("\r") && !session.text) {
          const m = tty.injected[0]!.match(/#([0-9a-f]{8})/);
          if (m) session.text = claudeUser(`#${m[1]}`);
        }
      },
      ...over,
    },
  };
  return rig;
}

test("blendedTurn: no mail → idle, nothing injected", async () => {
  const rig = turnRig("bt-idle");
  const r = await blendedTurn(rig.opts);
  assert.deepEqual(r, { ok: true, idle: true });
  assert.equal(rig.tty.injected.length, 0);
});

test("blendedTurn: ack-only batch absorbed — injector NEVER fires; operator ack still delivered", async () => {
  const rig = turnRig("bt-ack");
  enqueue(rig.inbox, "coder", "reviewer", "Standing by, no further action.");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.idle, true);
  assert.equal(rig.tty.injected.length, 0, "seat-to-seat ack absorbed without waking the pane");
  assert.equal(readNew(rig.inbox, "coder").length, 0, "…but still completed");

  const rig2 = turnRig("bt-opack");
  enqueue(rig2.inbox, "coder", "operator", "standing by — hold nothing further");
  const r2 = await blendedTurn(rig2.opts);
  assert.equal(r2.ok, true);
  assert.ok(rig2.tty.injected.length > 0, "the operator's one input ALWAYS lands (W4 #4)");
});

test("blendedTurn verified: mail → cur/, sessionFile persisted {blended:true}, delivered stamp", async () => {
  const rig = turnRig("bt-ok");
  enqueue(rig.inbox, "coder", "orchestrator", "brief: build S1");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.equal(readNew(rig.inbox, "coder").length, 0, "completed ONLY after verification");
  const sf = JSON.parse(readFileSync(sessionFile(rig.proj, "coder"), "utf8"));
  assert.deepEqual(sf, { agent: "claude", sessionId: "sess-blend-1", blended: true });
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /delivered \| #[0-9a-f]{8} \| mail=1 \| verified in sess-ble/);
});

test("blendedTurn unverified: mail STAYS in new/, FAILED stamps in turns.log + inert events.log line", async () => {
  const rig = turnRig("bt-fail", { sleep: noSleep }); // session never gains the marker
  enqueue(rig.inbox, "coder", "orchestrator", "doomed");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, false);
  assert.equal(readNew(rig.inbox, "coder").length, 1, "at-least-once: unverified mail survives");
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /delivery FAILED \| #[0-9a-f]{8}/);
  const ev = readFileSync(join(rig.proj, ".agents", "state", "events.log"), "utf8");
  assert.match(ev, /DELIVER_FAILED actor=engine seat=coder id=#[0-9a-f]{8}/);
  assert.ok(!/state=/.test(ev), "the honest-failure line carries NO state= token — inert to the state machine");
});

test("blendedTurn stale seat: kill→spawn→deliver ordering (lazy fresh-per-task reset)", async () => {
  const rig = turnRig("bt-stale");
  rig.opts.stale.markStale("coder");
  enqueue(rig.inbox, "coder", "orchestrator", "new task brief");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.equal(rig.events[0], "respawn:task boundary — fresh session per task", "respawn precedes the delivery (and the registry is never consulted for a stale seat)");
  assert.ok(rig.tty.injected.length > 0, "…and the fresh session receives the brief as its first mail");
  assert.equal(rig.opts.stale.isStale("coder"), false, "marker cleared after the reset");
});

test("blendedTurn dead pane: crash-recovery respawn before delivery", async () => {
  const rig = turnRig("bt-dead");
  rig.tty.exited = { code: 1 };
  const freshTty = fakeTty();
  rig.opts.respawn = async (reason) => {
    rig.events.push(`respawn:${reason}`);
    rig.tty = freshTty as FakeTty;
    return freshTty;
  };
  rig.opts.sleep = async () => {
    if (freshTty.injected.includes("\r") && !rig.session.text) {
      const m = freshTty.injected[0]!.match(/#([0-9a-f]{8})/);
      if (m) rig.session.text = claudeUser(`#${m[1]}`);
    }
  };
  enqueue(rig.inbox, "coder", "orchestrator", "are you alive");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.match(rig.events.find((e) => e.startsWith("respawn:"))!, /session not live/);
  assert.ok(freshTty.injected.length > 0, "delivery went to the respawned pane");
});

// ── runnerLoop seam (inherited machinery, verbatim) ──

test("runnerLoop + runTurnImpl: retries then dead-letter after maxRetries; loop machinery inherited", async () => {
  const proj = makeProject("loop-seam");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "coder", "orchestrator", "poison");
  const ctl = new AbortController();
  let calls = 0;
  const loop = runnerLoop({
    projectRoot: proj,
    seat: "coder",
    agent: "claude",
    pollMs: 5,
    maxRetries: 2,
    signal: ctl.signal,
    getParentPid: () => 0,
    runTurnImpl: async () => {
      calls++;
      return { ok: false, error: "delivery unverified (fake)" };
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  ctl.abort();
  await loop;
  assert.ok(calls >= 2, `the loop retried (${calls} calls)`);
  assert.equal(readNew(inbox, "coder").length, 0, "poison batch left new/ …");
  const cur = join(inbox, "coder", "cur");
  const failed = readdirSync(cur).filter((f) => f.endsWith(".failed"));
  assert.equal(failed.length, 1, "…as a dead letter, never silently dropped");
  assert.match(readFileSync(join(cur, failed[0]!), "utf8"), /delivery unverified/);
});

test("blendedLoop: a THROWING respawn is contained — failed turn, mail retried then dead-lettered, loop survives", async () => {
  const proj = makeProject("loop-crash");
  const inbox = join(proj, ".agents", "state", "inbox");
  enqueue(inbox, "coder", "orchestrator", "brief that hits a dead pane");
  const { blendedLoop } = await import("../src/blend.js");
  const ctl = new AbortController();
  let respawns = 0;
  const p = blendedLoop({
    projectRoot: proj,
    seat: "coder",
    cli: "claude",
    agentArg: "claude",
    getTty: () => undefined, // dead pane → blendedTurn must respawn
    respawn: async () => {
      respawns++;
      throw new Error("spawn refused (wall)");
    },
    readSession: () => "",
    currentSessionId: () => undefined,
    stale: createStaleTracker(),
    pollMs: 5,
    maxRetries: 2,
    spawnSettleMs: 0,
    sleep: noSleep,
    signal: ctl.signal,
  });
  await new Promise((r) => setTimeout(r, 300));
  ctl.abort();
  await p;
  assert.ok(respawns >= 2, `the loop survived the throw and retried (${respawns} respawn attempts)`);
  const cur = join(inbox, "coder", "cur");
  const failed = readdirSync(cur).filter((f) => f.endsWith(".failed"));
  assert.equal(failed.length, 1, "honest dead letter after retries — never silent loss");
  assert.match(readFileSync(join(cur, failed[0]!), "utf8"), /spawn refused/);
  const log = readFileSync(join(proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /delivery turn CRASHED: spawn refused \(wall\)/);
});

test("blended boot hazard: a stale attended marker must not freeze deliveries (cleared via blendedLoop path)", async () => {
  const proj = makeProject("stale-attended");
  writeFileSync(attendedFile(proj, "coder"), JSON.stringify({ pid: 99999999 }));
  // blendedLoop clears it before the first wake — drive one aborted loop
  const { blendedLoop } = await import("../src/blend.js");
  const ctl = new AbortController();
  const p = blendedLoop({
    projectRoot: proj,
    seat: "coder",
    cli: "claude",
    agentArg: "claude",
    getTty: () => undefined,
    respawn: async () => fakeTty(),
    readSession: () => "",
    currentSessionId: () => undefined,
    stale: createStaleTracker(),
    pollMs: 5,
    signal: ctl.signal,
  });
  await new Promise((r) => setTimeout(r, 30));
  ctl.abort();
  await p;
  assert.equal(existsSync(attendedFile(proj, "coder")), false, "blended seats are never held");
});

// ── S3: orientation, the fresh-start lever, graceful reset, candidates ──

test("renderOrientation: binder + state pointers + rails; orchestrator adds the checkpoint; no control chars", () => {
  const o = renderOrientation("coder");
  assert.match(o, /\.agents\/config\/coder\.md/);
  assert.match(o, /\.agents\/state\/coder\.md/);
  assert.match(o, /agentctl\.py deliver <role> --from coder/);
  assert.ok(!/checkpoint/.test(o), "workers carry no checkpoint pointer");
  assert.ok(![...o].some((c) => c.charCodeAt(0) < 32), "no control chars — submit is the injector's job");
  assert.match(renderOrientation("orchestrator"), /including your latest checkpoint/);
});

test("renderMailBlock: orientation rides between the header and the mail; absent by default", () => {
  const msgs = [msg("orchestrator", "brief")];
  const plain = renderMailBlock(msgs, "aa11bb22");
  assert.ok(!plain.includes("[fresh session"), "no orientation unless asked");
  const oriented = renderMailBlock(msgs, "aa11bb22", false, renderOrientation("coder"));
  const lines = oriented.split("\n");
  assert.match(lines[0]!, /^\[team mail #aa11bb22/);
  assert.match(lines[1]!, /^\[fresh session — orient first\]/);
  assert.ok(oriented.includes("from orchestrator: brief"));
});

test("sessionOriented: a prior engine delivery as a USER record = oriented; an assistant quote is not", () => {
  assert.equal(sessionOriented(undefined, "claude"), false, "no session yet = not oriented");
  assert.equal(sessionOriented("", "claude"), false);
  assert.equal(sessionOriented(claudeUser("[team mail #ab12cd34 — engine delivery]\nbrief"), "claude"), true);
  assert.equal(sessionOriented(claudeAssistant('quoting a "[team mail #ab12cd34" header'), "claude"), false);
});

test("sessionFilesIn + findBlendSessionCandidates: ALL files since spawn, newest first (shared-cwd coherence)", () => {
  const proj = makeProject("cands");
  const home = join(scratch, "cands-home");
  const dir = join(home, ".claude", "projects", realpathSync(proj).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sess-a.jsonl"), "");
  writeFileSync(join(dir, "sess-b.jsonl"), "");
  writeFileSync(join(dir, "sess-old.jsonl"), "");
  const now = Date.now() / 1000;
  utimesSync(join(dir, "sess-a.jsonl"), now - 5, now - 5);
  utimesSync(join(dir, "sess-b.jsonl"), now, now);
  utimesSync(join(dir, "sess-old.jsonl"), now - 3600, now - 3600); // pre-spawn: another life
  const cands = findBlendSessionCandidates("claude", { projectRoot: proj, home, sinceMs: Date.now() - 60_000 });
  assert.deepEqual(cands.map((c) => c.sessionId), ["sess-b", "sess-a"], "both live candidates, newest first, the old life excluded");
  assert.equal(findBlendSession("claude", { projectRoot: proj, home, sinceMs: Date.now() - 60_000 })!.sessionId, "sess-b");
});

/** A sleep hook that "lands" EVERY submitted paste as a user record (the
 * turnRig default only lands the first) — multi-delivery tests need it. */
function autoLandSleep(rig: ReturnType<typeof turnRig>): (ms: number) => Promise<void> {
  return async () => {
    const lastPaste = rig.tty.injected.filter((s) => s.startsWith("\x1b[200~")).at(-1);
    if (!lastPaste || rig.tty.injected.at(-1) !== "\r") return;
    const m = lastPaste.match(/#([0-9a-f]{8})/);
    if (m && !rig.session.text.includes(`#${m[1]}`)) {
      rig.session.text += claudeUser(lastPaste.slice("\x1b[200~".length, -"\x1b[201~".length)) + "\n";
    }
  };
}

test("blendedTurn: a FRESH session's first delivery carries the visible re-orientation; an oriented one does not", async () => {
  const rig = turnRig("bt-orient");
  rig.opts.sleep = autoLandSleep(rig);
  enqueue(rig.inbox, "coder", "orchestrator", "first brief");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  const paste = rig.tty.injected[0]!;
  assert.ok(paste.includes("[fresh session — orient first]"), "empty session = fresh = oriented on screen");
  assert.ok(paste.includes(".agents/config/coder.md"));

  // session now holds the delivery as a USER record → the next turn is slim
  enqueue(rig.inbox, "coder", "orchestrator", "second mail");
  const r2 = await blendedTurn(rig.opts);
  assert.equal(r2.ok, true);
  const paste2 = rig.tty.injected.filter((s) => s.startsWith("\x1b[200~")).at(-1)!;
  assert.ok(!paste2.includes("[fresh session"), "an oriented session gets mail alone (speed law)");

  // the supervisor's override wins over inference (crash-resume case)
  const rig3 = turnRig("bt-orient-ovr", { needsOrientation: () => false });
  enqueue(rig3.inbox, "coder", "orchestrator", "resumed session mail");
  await blendedTurn(rig3.opts);
  assert.ok(!rig3.tty.injected[0]!.includes("[fresh session"), "resumed = already oriented, even though unpinned");
});

test("blendedTurn: the external fresh-start lever — a dropped session.json forces a fresh respawn, consumed once", async () => {
  const persistRef = { persisted: true }; // armed: a prior delivery persisted the file
  const rig = turnRig("bt-lever", { persistRef });
  rig.opts.sleep = autoLandSleep(rig);
  // no sessionFile on disk = an outside hand (agentctl verify-fresh-eyes / D12) dropped it
  enqueue(rig.inbox, "coder", "orchestrator", "verify branch feat/x — fresh eyes");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.match(rig.events.find((e) => e.startsWith("respawn:"))!, /task boundary — fresh session per task/);
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /session\.json dropped by the fresh-start lever/);
  assert.equal(persistRef.persisted, true, "re-armed by the delivery's own persist");
  assert.ok(existsSync(sessionFile(rig.proj, "coder")), "the fresh session was persisted again");

  // consumed once: with the file present again, the next turn does NOT respawn
  const before = rig.events.filter((e) => e.startsWith("respawn:")).length;
  enqueue(rig.inbox, "coder", "orchestrator", "more work");
  await blendedTurn(rig.opts);
  assert.equal(rig.events.filter((e) => e.startsWith("respawn:")).length, before, "no lever, no respawn");
});

test("blendedTurn: an UNARMED lever (no prior persist) never respawns on a merely-absent session file", async () => {
  const rig = turnRig("bt-lever-unarmed", { persistRef: { persisted: false } });
  enqueue(rig.inbox, "coder", "orchestrator", "first ever brief");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.equal(rig.events.filter((e) => e.startsWith("respawn:")).length, 0, "a never-persisted seat is simply fresh, not dropped");
});

test("blendedTurn: a stale reset DEFERS while the agent is mid-response — the reset never tears a turn", async () => {
  let respondingCalls = 0;
  const rig = turnRig("bt-defer", {
    responding: () => {
      respondingCalls++;
      return respondingCalls <= 3; // quiet on the 4th look
    },
  });
  rig.opts.stale.markStale("coder");
  enqueue(rig.inbox, "coder", "orchestrator", "next task");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.ok(respondingCalls >= 4, "the reset waited for quiet");
  assert.ok(rig.events.some((e) => e.startsWith("respawn:")), "…then respawned");
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /fresh respawn deferred — the agent is mid-response/);
});

test("blendedTurn: onVerified (session pinning) fires after verification, BEFORE the sessionFile persist", async () => {
  const order: string[] = [];
  const rig = turnRig("bt-pin", {
    onVerified: (id) => {
      order.push(`pinned:#${id}`);
      assert.equal(existsSync(sessionFile(join(scratch, "bt-pin"), "coder")), false, "pin precedes persist");
    },
    currentSessionId: () => {
      order.push("read-sid");
      return "sess-pinned";
    },
  });
  enqueue(rig.inbox, "coder", "orchestrator", "pin me");
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.match(order[0]!, /^pinned:#[0-9a-f]{8}$/);
  assert.equal(order[1], "read-sid");
  const sf = JSON.parse(readFileSync(sessionFile(rig.proj, "coder"), "utf8"));
  assert.equal(sf.sessionId, "sess-pinned", "only PINNED truth is ever persisted");
});

// ── Pack 1: delivery reliability — dead-letter cure + early-stop watchdog ──

test("CLI_DELIVERY: every verify ceiling spans a busy boundary (ticket-#4 retro: 6 dead-letters under claude's 30s ceiling)", () => {
  for (const cli of ["claude", "pi", "codex"] as const) {
    assert.ok(CLI_DELIVERY[cli].verifyTimeoutMs >= 120_000, `${cli}'s window must span a long tool execution / turn remainder`);
  }
});

test("deliverToBlendedSeat redelivery: EVERY paste wears the REDELIVERY header (a retried id is never invisible)", async () => {
  const tty = fakeTty();
  let session = "";
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "retry me")],
    cli: "claude",
    readSession: () => session,
    id: "aa11bb22",
    redelivery: true,
    verifyTimeoutMs: 10,
    verifyPollMs: 1,
    sleep: async () => {
      if (tty.injected.includes("\r")) session = claudeUser("#aa11bb22");
    },
    now: Date.now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.id, "aa11bb22", "the retry keeps its ORIGINAL id — dedup-by-id stays possible");
  assert.match(tty.injected[0]!, /REDELIVERY; ignore if already received/, "attempt 1 of a retry is already visibly a duplicate");
});

test("deliverToBlendedSeat redelivery: a late-landed prior attempt is DRAINED — ok, zero pastes, attempts=0", async () => {
  const tty = fakeTty();
  const r = await deliverToBlendedSeat({
    tty,
    msgs: [msg("orchestrator", "landed late")],
    cli: "claude",
    readSession: () => claudeUser("[team mail #cc33dd44 — engine delivery]\nlanded late"),
    id: "cc33dd44",
    redelivery: true,
    verifyTimeoutMs: 10,
    verifyPollMs: 1,
    sleep: noSleep,
    now: Date.now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 0, "no paste this call — the prior attempt's landing was found");
  assert.equal(tty.injected.length, 0, "the slow write is never re-minted as new mail");
});

test("assistantTurnStartedAfter: assistant AFTER the marker = attended; before it (or an echo alone) is not", () => {
  const marker = "#ab12cd34";
  const userLine = claudeUser(`[team mail ${marker} — engine delivery]\nbrief`);
  assert.equal(assistantTurnStartedAfter(claudeAssistant("old turn") + "\n" + userLine, marker, "claude"), false, "a turn that PRECEDED the mail has not seen it");
  assert.equal(assistantTurnStartedAfter(userLine + "\n" + claudeAssistant("on it"), marker, "claude"), true);
  assert.equal(assistantTurnStartedAfter(claudeAssistant(`echoing ${marker}`) + "\n" + claudeAssistant("more"), marker, "claude"), false, "an assistant echo never counts as the delivery");
  // pi shapes
  const piUser = JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: `mail ${marker}` }] } });
  const piAssistant = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "working" }] } });
  assert.equal(assistantTurnStartedAfter(piUser + "\n" + piAssistant, marker, "pi"), true);
  assert.equal(assistantTurnStartedAfter(piUser, marker, "pi"), false);
  // codex shapes: agent_message event OR assistant response_item
  const cxUser = JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: `mail ${marker}` } });
  const cxAgent = JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "working" } });
  const cxItem = JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: "working" }] } });
  assert.equal(assistantTurnStartedAfter(cxUser + "\n" + cxAgent, marker, "codex"), true);
  assert.equal(assistantTurnStartedAfter(cxUser + "\n" + cxItem, marker, "codex"), true);
  assert.equal(assistantTurnStartedAfter(cxUser, marker, "codex"), false);
});

test("watchForEarlyStop: the turn starts inside the window → disarms silently, nothing injected", async () => {
  const tty = fakeTty();
  let nowMs = 0;
  let session = claudeUser("[team mail #ee55ff66 — engine delivery]\nbrief");
  const r = await watchForEarlyStop({
    tty,
    cli: "claude",
    readSession: () => session,
    id: "ee55ff66",
    nudgeAfterMs: 1000,
    pollMs: 100,
    sleep: async (ms) => {
      nowMs += ms;
      if (nowMs >= 300) session += "\n" + claudeAssistant("on it");
    },
    now: () => nowMs,
  });
  assert.equal(r, false);
  assert.equal(tty.injected.length, 0, "an attended delivery is never nudged");
});

test("watchForEarlyStop: silence past the window → ONE standing nudge, paste-wrapped + separate CR", async () => {
  const tty = fakeTty();
  let nowMs = 0;
  const session = claudeUser("[team mail #ee55ff66 — engine delivery]\nbrief");
  const r = await watchForEarlyStop({
    tty,
    cli: "claude",
    readSession: () => session,
    id: "ee55ff66",
    nudgeAfterMs: 1000,
    pollMs: 100,
    submitDelayMs: 1,
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
  });
  assert.equal(r, true);
  assert.equal(tty.injected.length, 2, "one paste + one CR — a single inject, zero new machinery");
  assert.match(tty.injected[0]!, /^\x1b\[200~\[engine watchdog\] team mail #ee55ff66/);
  assert.match(tty.injected[0]!, /ignore this/, "defensive wording — a mid-work landing must read as ignorable");
  assert.equal(tty.injected[1], "\r");
});

test("watchForEarlyStop: a newer delivery supersedes; a vanished marker (respawn) stands down", async () => {
  const wdRef = { gen: 2 };
  const tty = fakeTty();
  let nowMs = 0;
  const superseded = await watchForEarlyStop({
    tty,
    cli: "claude",
    readSession: () => claudeUser("[team mail #aa00bb11]"),
    id: "aa00bb11",
    wdRef,
    gen: 1, // an older generation — a newer delivery armed its own watchdog
    nudgeAfterMs: 1000,
    pollMs: 100,
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
  });
  assert.equal(superseded, false);
  assert.equal(tty.injected.length, 0);

  nowMs = 0;
  const stale = await watchForEarlyStop({
    tty,
    cli: "claude",
    readSession: () => claudeUser("a FRESH session with no marker"), // respawn/refresh rewrote the world
    id: "aa00bb11",
    nudgeAfterMs: 1000,
    pollMs: 100,
    sleep: async (ms) => {
      nowMs += ms;
    },
    now: () => nowMs,
  });
  assert.equal(stale, false);
  assert.equal(tty.injected.length, 0, "a stale watchdog never nudges a session about mail it cannot see");
});

test("blendedTurn + retryRef: a failed batch RETRIES under its own id; the late landing is drained, not re-minted", async () => {
  const retryRef: { id?: string; batch?: string } = {};
  const rig = turnRig("bt-retry-id", { retryRef, sleep: noSleep }); // never lands → attempt fails
  enqueue(rig.inbox, "coder", "orchestrator", "slow boundary");
  const r1 = await blendedTurn(rig.opts);
  assert.equal(r1.ok, false);
  const id = rig.tty.injected[0]!.match(/#([0-9a-f]{8})/)![1]!;
  assert.equal(retryRef.id, id, "the failed id is parked for the retry");

  // the paste lands LATE (the long tool execution ends) before the retry turn
  rig.session.text = claudeUser(`[team mail #${id} — engine delivery]\nslow boundary`);
  const pastesBefore = rig.tty.injected.filter((s) => s.startsWith("\x1b[200~")).length;
  const r2 = await blendedTurn(rig.opts);
  assert.equal(r2.ok, true);
  assert.equal(rig.tty.injected.filter((s) => s.startsWith("\x1b[200~")).length, pastesBefore, "drained — ZERO new pastes, no duplicate mail");
  assert.equal(readNew(rig.inbox, "coder").length, 0, "the batch completed under its ORIGINAL id");
  assert.equal(retryRef.id, undefined, "continuity cleared on success");
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, new RegExp(`delivered \\| #${id} .*late landing drained`));
});

test("blendedTurn + retryRef: a CHANGED batch (new mail joined) mints fresh — content differs, no false drain", async () => {
  const retryRef: { id?: string; batch?: string } = {};
  const rig = turnRig("bt-retry-grow", { retryRef, sleep: noSleep });
  enqueue(rig.inbox, "coder", "orchestrator", "first");
  const r1 = await blendedTurn(rig.opts);
  assert.equal(r1.ok, false);
  const failedId = retryRef.id!;

  enqueue(rig.inbox, "coder", "reviewer", "second — joined while queued");
  rig.opts.sleep = autoLandSleep(rig);
  const r2 = await blendedTurn(rig.opts);
  assert.equal(r2.ok, true);
  const lastPaste = rig.tty.injected.filter((s) => s.startsWith("\x1b[200~")).at(-1)!;
  assert.ok(!lastPaste.includes(`#${failedId}`), "a grown batch is NEW mail under a new id");
  assert.ok(!lastPaste.includes("REDELIVERY"), "…and honestly not a redelivery");
});

test("blendedTurn + wdRef: a verified-but-unattended delivery gets the standing nudge + inert WATCHDOG_NUDGE record", async () => {
  const wdRef = { gen: 0 };
  // The watchdog runs on the REAL clock by design (never a test's fake sleep
  // — the blendteam hot-spin lesson), so the window here is real milliseconds.
  const rig = turnRig("bt-watchdog", { wdRef, nudgeAfterMs: 50, watchdogPollMs: 10, submitDelayMs: 1 });
  enqueue(rig.inbox, "coder", "orchestrator", "brief, then silence"); // the default sleep hook lands the marker; no assistant follows
  const r = await blendedTurn(rig.opts);
  assert.equal(r.ok, true);
  assert.equal(wdRef.gen, 1, "the watchdog armed on the verified delivery");
  await new Promise((res) => setTimeout(res, 500)); // the floating watchdog runs on real time
  assert.ok(
    rig.tty.injected.some((s) => s.includes("[engine watchdog] team mail #")),
    "no assistant turn inside the window → the nudge landed",
  );
  const ev = readFileSync(join(rig.proj, ".agents", "state", "events.log"), "utf8");
  assert.match(ev, /WATCHDOG_NUDGE actor=engine seat=coder id=#[0-9a-f]{8}/);
  assert.ok(!/state=/.test(ev), "a record, never a transition — no state= token");
  const log = readFileSync(join(rig.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /early-stop watchdog \| #[0-9a-f]{8} delivered but no turn started/);
});

// ── pi node picker (the superman node-20 crash mitigation) ──

test("pickPiNodeVersion: newest >= 22 wins; node 20 never picked; junk ignored", () => {
  assert.equal(pickPiNodeVersion(["v20.20.2", "v22.22.2", "v22.9.0"]), "v22.22.2");
  assert.equal(pickPiNodeVersion(["v20.20.2"]), undefined, "old node would crash pi — better none than a lie");
  assert.equal(pickPiNodeVersion(["junk", ".DS_Store", "v23.1.0"]), "v23.1.0");
  assert.equal(pickPiNodeVersion([]), undefined);
});

// keep scratch until the process exits (node:test runs files in-process)
process.on("exit", () => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
