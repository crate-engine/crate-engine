// THE BLENDED PANE — S2 opt-in: the supervisor + teamproc branching +
// teamview's live-session lens. House pattern: mkdtemp scratch rigs, stub
// spawner/starter/PTY seams; the real PTY leg is the S2 gate proof, not
// mocked here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, appendFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStaleTracker } from "../src/blend.js";
import { BlendedSeat, type BlendedSeatHandle } from "../src/blendseat.js";
import { enqueue, readNew } from "../src/mailbox.js";
import type { Seat } from "../src/manifest.js";
import type { StartTtyOpts, StartTtyResult, TtySeat } from "../src/ptyseat.js";
import { sessionFile } from "../src/runner.js";
import { TeamProcess, type SeatSpawner } from "../src/gui/teamproc.js";
import { readTeamView } from "../src/gui/teamview.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-blendseat-"));
const noSleep = async (_ms: number) => {};

function rig(name: string, conf: string): string {
  const p = join(scratch, name);
  mkdirSync(join(p, ".agents", "state", "inbox"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), conf);
  return p;
}

async function waitFor(cond: () => boolean, ms = 5000, label = "condition"): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ── TeamProcess branching (stub spawner + stub blend starter) ──

const stubSpawner: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

class FakeHandle implements BlendedSeatHandle {
  readonly startedAt = Date.now();
  live = true;
  respondingNow = false;
  stops = 0;
  alive(): boolean {
    return this.live;
  }
  responding(): boolean {
    return this.respondingNow;
  }
  stop(): void {
    this.stops++;
    this.live = false;
  }
}

function fakeStarter() {
  const calls: Seat[] = [];
  const handles: FakeHandle[] = [];
  const starter = (seat: Seat, _projectRoot: string) => {
    calls.push(seat);
    const h = new FakeHandle();
    handles.push(h);
    return h;
  };
  return { calls, handles, starter };
}

test("teamproc: flagged+eligible seat boots BLENDED in-process; the other four stay runner children", () => {
  const p = rig("tp-branch", 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const { calls, starter } = fakeStarter();
  const tp = new TeamProcess(p, stubSpawner, starter);
  try {
    const st = tp.boot();
    assert.deepEqual(calls, ["coder"], "exactly the flagged seat routed to the blend starter");
    const coder = st.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.mode, "blended");
    assert.equal(coder.alive, true);
    assert.equal(coder.pid, null, "no runner pid — the loop lives in this process");
    const others = st.seats.filter((s) => s.seat !== "coder");
    assert.ok(others.every((s) => s.alive && s.pid !== null && s.mode === undefined), "un-flagged seats byte-identical: runner children");
  } finally {
    tp.stop();
  }
});

test("teamproc: boot is idempotent for a live blended seat; stop() stops the handle", () => {
  const p = rig("tp-idem", 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const { calls, handles, starter } = fakeStarter();
  const tp = new TeamProcess(p, stubSpawner, starter);
  try {
    tp.boot();
    tp.boot();
    assert.equal(calls.length, 1, "a live blended seat is left alone on re-boot");
    tp.stop();
    assert.equal(handles[0]!.stops, 1, "stop() reaches the blended handle");
    assert.equal(tp.status().seats.find((s) => s.seat === "coder")!.alive, false);
  } finally {
    tp.stop();
  }
});

test("teamproc: relaunch stops the old blended handle, re-reads rig.conf (un-flagging falls back to a runner child)", () => {
  const p = rig("tp-relaunch", 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const { calls, handles, starter } = fakeStarter();
  const tp = new TeamProcess(p, stubSpawner, starter);
  try {
    tp.boot();
    tp.relaunch("coder");
    assert.equal(handles[0]!.stops, 1, "the old handle was stopped");
    assert.equal(calls.length, 2, "…and a fresh one started");
    // Un-flag the seat: the next relaunch must land on the runner path — the
    // branch is decided FRESH from rig.conf every launch.
    writeFileSync(join(p, ".agents", "rig.conf"), 'CODER_AGENT="claude"\n');
    const st = tp.relaunch("coder");
    assert.equal(handles[1]!.stops, 1, "the blended handle was stopped on the way out");
    const coder = st.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.mode, undefined, "back to a runner child");
    assert.ok(coder.alive && coder.pid !== null);
  } finally {
    tp.stop();
  }
});

test("teamproc: flagged but INELIGIBLE agent fails open to headless with an honest stamp — never a dead seat", () => {
  const p = rig("tp-inelig", 'TESTER_AGENT="aider"\nBLEND_TESTER=1\n');
  const { calls, starter } = fakeStarter();
  const tp = new TeamProcess(p, stubSpawner, starter);
  try {
    const st = tp.boot();
    assert.deepEqual(calls, [], "the starter never fires for an unverified agent");
    const tester = st.seats.find((s) => s.seat === "tester")!;
    assert.equal(tester.mode, undefined);
    assert.ok(tester.alive && tester.pid !== null, "the seat runs headless instead");
    const log = readFileSync(join(p, ".agents", "state", "turns", "tester", "turns.log"), "utf8");
    assert.match(log, /blend requested \(BLEND_TESTER=1\) but .*stays headless/);
  } finally {
    tp.stop();
  }
});

test("teamproc: no blend starter injected → flagged seat stays headless (the branch is additive)", () => {
  const p = rig("tp-nostarter", 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const tp = new TeamProcess(p, stubSpawner);
  try {
    const st = tp.boot();
    const coder = st.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.mode, undefined);
    assert.ok(coder.alive && coder.pid !== null);
  } finally {
    tp.stop();
  }
});

test("teamproc refreshBlended: visible-restart semantics — refused mid-response, session dropped + relaunched when quiet", () => {
  const p = rig("tp-refresh", 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const { calls, handles, starter } = fakeStarter();
  const tp = new TeamProcess(p, stubSpawner, starter);
  try {
    // non-blended seat → not handled (the caller falls through to refreshSeat)
    assert.deepEqual(tp.refreshBlended("reviewer"), { handled: false });
    tp.boot();
    writeFileSync(sessionFile(p, "coder"), JSON.stringify({ agent: "claude", sessionId: "sess-x", blended: true }));
    handles[0]!.respondingNow = true;
    const refused = tp.refreshBlended("coder");
    assert.equal(refused.handled, true);
    assert.equal(refused.ok, false);
    assert.match(refused.reason ?? "", /mid-response/);
    assert.ok(existsSync(sessionFile(p, "coder")), "a refusal drops nothing");
    handles[0]!.respondingNow = false;
    const ok = tp.refreshBlended("coder");
    assert.deepEqual({ handled: ok.handled, ok: ok.ok }, { handled: true, ok: true });
    assert.equal(existsSync(sessionFile(p, "coder")), false, "session dropped → the new pane opens FRESH");
    assert.equal(handles[0]!.stops, 1, "old pane stopped");
    assert.equal(calls.length, 2, "…and respawned — the refresh is VISIBLE");
    const log = readFileSync(join(p, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
    assert.match(log, /refreshed \(blended\)/);
  } finally {
    tp.stop();
  }
});

// ── BlendedSeat end-to-end with a stubbed PTY (real maildir, real fs) ──

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

interface FakePty extends TtySeat {
  injected: string[];
}

/** A stub PTY that behaves like the probed claude TUI: a bracketed paste
 * parks in the composer; the SEPARATE CR "submits" it — the pasted text
 * lands as a user record in the session jsonl. */
function makeFakePty(seat: string, projectRoot: string, file: string): FakePty {
  const subs = new Set<(ev: { data?: Buffer; exit?: { code: number } }) => void>();
  let pending: string | undefined;
  const tty: FakePty = {
    seat,
    projectRoot,
    agent: "claude",
    startedAtMs: Date.now(),
    cols: 120,
    rows: 32,
    blended: true,
    composerDirty: false,
    injected: [],
    write: () => {},
    inject: (d) => {
      const s = typeof d === "string" ? d : d.toString("utf8");
      tty.injected.push(s);
      if (s.startsWith(PASTE_START)) pending = s.slice(PASTE_START.length, -PASTE_END.length);
      else if (s === "\r" && pending !== undefined) {
        appendFileSync(file, JSON.stringify({ type: "user", message: { role: "user", content: pending } }) + "\n");
        pending = undefined;
      }
    },
    resize: () => {},
    kill: () => {
      tty.exited = { code: 0 };
      for (const cb of subs) cb({ exit: { code: 0 } });
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    replay: () => Buffer.alloc(0),
  };
  return tty;
}

interface PtyRig {
  proj: string;
  home: string;
  inbox: string;
  claudeDir: string;
  ttys: FakePty[];
  busyFirst: { n: number };
  startCalls: number;
  startTty: (o: StartTtyOpts) => Promise<StartTtyResult>;
}

function ptyRig(name: string): PtyRig {
  const proj = rig(name, 'CODER_AGENT="claude"\nBLEND_CODER=1\n');
  const home = join(scratch, `${name}-home`);
  const claudeDir = join(home, ".claude", "projects", realpathSync(proj).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(claudeDir, { recursive: true });
  let seq = 0;
  const r: PtyRig = {
    proj,
    home,
    inbox: join(proj, ".agents", "state", "inbox"),
    claudeDir,
    ttys: [],
    busyFirst: { n: 0 },
    startCalls: 0,
    startTty: async (_o) => {
      r.startCalls++;
      if (r.busyFirst.n > 0) {
        r.busyFirst.n--;
        return { ok: false, busy: true };
      }
      seq++;
      const file = join(claudeDir, `sess-${seq}.jsonl`);
      writeFileSync(file, "");
      const tty = makeFakePty("coder", proj, file);
      r.ttys.push(tty);
      return { ok: true, tty, reattached: false };
    },
  };
  return r;
}

function makeSeat(r: PtyRig, over: Partial<ConstructorParameters<typeof BlendedSeat>[0]> = {}): BlendedSeat {
  return new BlendedSeat({
    projectRoot: r.proj,
    seat: "coder",
    agentArg: "claude",
    cli: "claude",
    home: r.home,
    stale: createStaleTracker(),
    startTty: r.startTty,
    sleep: noSleep,
    spawnSettleMs: 0,
    pollMs: 15,
    busyPollMs: 1,
    ...over,
  });
}

test("BlendedSeat: spawns the pane eagerly, delivers verified mail, persists the discovered session", async () => {
  const r = ptyRig("bs-e2e");
  const bs = makeSeat(r);
  bs.start();
  try {
    await waitFor(() => r.ttys.length === 1, 5000, "eager first spawn");
    assert.equal(bs.alive(), true);
    enqueue(r.inbox, "coder", "orchestrator", "brief: build the thing");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "verified delivery completes the mail");
    const tty = r.ttys[0]!;
    const paste = tty.injected.find((s) => s.startsWith(PASTE_START))!;
    assert.ok(paste.includes("brief: build the thing"), "the mail body rode the bracketed paste");
    assert.ok(tty.injected.includes("\r"), "…with a SEPARATE CR submit");
    const sf = JSON.parse(readFileSync(sessionFile(r.proj, "coder"), "utf8"));
    assert.deepEqual(sf, { agent: "claude", sessionId: "sess-1", blended: true }, "discovered session persisted for gauges + crash-resume");
  } finally {
    bs.stop();
  }
});

test("BlendedSeat: a stale (task-boundary) seat respawns FRESH before the next delivery — old pane killed, sessionFile dropped", async () => {
  const r = ptyRig("bs-fresh");
  const stale = createStaleTracker();
  const bs = makeSeat(r, { stale });
  bs.start();
  try {
    await waitFor(() => r.ttys.length === 1, 5000, "first spawn");
    enqueue(r.inbox, "coder", "orchestrator", "task one");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "first delivery");
    stale.markStale("coder"); // what the task-end watcher does at CLOSE
    enqueue(r.inbox, "coder", "orchestrator", "task two — clean eyes");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "second delivery");
    assert.equal(r.ttys.length, 2, "the delivery respawned a fresh pane");
    assert.deepEqual(r.ttys[0]!.exited, { code: 0 }, "the old pane was killed first");
    assert.equal(stale.isStale("coder"), false, "marker cleared by the reset");
    const sf = JSON.parse(readFileSync(sessionFile(r.proj, "coder"), "utf8"));
    assert.equal(sf.sessionId, "sess-2", "the NEW session carries the seat now");
    const paste2 = r.ttys[1]!.injected.find((s) => s.startsWith(PASTE_START))!;
    assert.ok(paste2.includes("task two"), "the fresh session's first mail is the new brief");
  } finally {
    bs.stop();
  }
});

test("BlendedSeat: a busy door (headless turn mid-flight) is waited out, then the pane opens", async () => {
  const r = ptyRig("bs-busy");
  r.busyFirst.n = 2;
  const bs = makeSeat(r);
  bs.start();
  try {
    await waitFor(() => r.ttys.length === 1, 5000, "spawn after the busy window");
    assert.ok(r.startCalls >= 3, "busy refusals were retried, not fatal");
    const log = readFileSync(join(r.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
    assert.match(log, /pane held busy — a headless turn is mid-flight/);
  } finally {
    bs.stop();
  }
});

test("BlendedSeat: stop() kills the pane and ends the loop (alive → false); a spawn refusal is not fatal to the seat", async () => {
  const r = ptyRig("bs-stop");
  const bs = makeSeat(r);
  bs.start();
  await waitFor(() => r.ttys.length === 1, 5000, "spawn");
  bs.stop();
  assert.deepEqual(r.ttys[0]!.exited, { code: 0 }, "the engine cleans up the process it spawned");
  await waitFor(() => !bs.alive(), 5000, "loop ends");

  // refusal path: the loop must survive boot without a pane (honest stamp,
  // retry at the next delivery) — never a dead seat with a silent log.
  const r2 = ptyRig("bs-refuse");
  const bs2 = makeSeat(r2, { startTty: async () => ({ ok: false, error: "no such binary" }) });
  bs2.start();
  try {
    await waitFor(() => {
      try {
        return /blended boot could not open the pane: no such binary/.test(
          readFileSync(join(r2.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8"),
        );
      } catch {
        return false;
      }
    }, 5000, "honest boot-refusal stamp");
    assert.equal(bs2.alive(), true, "the standing loop survives — the next delivery retries the spawn");
  } finally {
    bs2.stop();
  }
});

// ── teamview: the blended seat's live-session lens ──

test("teamview: a flagged claude seat reports blended + gauge/responding from its live session file; un-flagged seats unchanged", () => {
  const proj = rig("tv-blend", 'CODER_AGENT="claude"; CODER_MODEL="opus"\nBLEND_CODER=1\nREVIEWER_AGENT="pi"\n');
  const home = join(scratch, "tv-blend-home");
  const claudeDir = join(home, ".claude", "projects", realpathSync(proj).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(claudeDir, { recursive: true });
  const sess = join(claudeDir, "sess-tv.jsonl");
  writeFileSync(
    sess,
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 40_000, cache_read_input_tokens: 10_000, output_tokens: 5 } } }) + "\n",
  );
  writeFileSync(sessionFile(proj, "coder"), JSON.stringify({ agent: "claude", sessionId: "sess-tv", blended: true }));

  const view = readTeamView(proj, 5, home);
  const coder = view.seats.find((s) => s.seat === "coder")!;
  assert.equal(coder.blended, true);
  assert.equal(coder.responding, true, "a just-written session file = mid-response");
  assert.ok(coder.lastOutputAt, "idle-chip fuel present");
  assert.ok(coder.gauge, "gauge read from the SESSION file (no headless turn jsonl exists)");
  assert.equal(coder.gauge!.tokens, 50_000, "context fullness = input + cache-read");

  const reviewer = view.seats.find((s) => s.seat === "reviewer")!;
  assert.equal(reviewer.blended, undefined, "un-flagged seat carries no blended fields");

  // quiet session → responding false (the pane shows idle-since, honestly)
  const old = Date.now() / 1000 - 60;
  utimesSync(sess, old, old);
  const view2 = readTeamView(proj, 5, home);
  assert.equal(view2.seats.find((s) => s.seat === "coder")!.responding, false);
});

test("teamview: a flagged but INELIGIBLE agent renders NO blended pane (it fell back to headless at boot)", () => {
  const proj = rig("tv-inelig", 'DESIGNER_AGENT="aider"\nBLEND_DESIGNER=1\n');
  const view = readTeamView(proj, 5, join(scratch, "tv-inelig-home"));
  assert.equal(view.seats.find((s) => s.seat === "designer")!.blended, undefined, "no phantom pane for a seat the boot refused to blend");
});
