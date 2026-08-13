// THE BLENDED PANE — S3: all-seats coherence. When EVERY seat is flagged the
// whole team lives as engine-owned panes sharing ONE cwd — so these tests
// prove the parts that only exist at team scale: mail between two blended
// seats through real maildirs, session PINNING against a decoy newer file
// (five seats share one claude project dir — "newest" lies), the task-end
// crew reset (workers fresh, orchestrator persists), the external
// fresh-start lever (agentctl's verify-dispatch fresh-eyes / D12), and
// CONTEXT_AUTO_REFRESH as a VISIBLE restart. House pattern: mkdtemp scratch
// rigs, stub PTYs behaving like the probed claude TUI; the real PTY leg is
// the S3 gate proof, not mocked here.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStaleTracker } from "../src/blend.js";
import { BlendedSeat, blendCrewFor } from "../src/blendseat.js";
import { enqueue, readNew } from "../src/mailbox.js";
import type { Seat } from "../src/manifest.js";
import type { StartTtyOpts, StartTtyResult, TtySeat } from "../src/ptyseat.js";
import { sessionFile } from "../src/runner.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-blendteam-"));
const noSleep = async (_ms: number) => {};
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

async function waitFor(cond: () => boolean, ms = 5000, label = "condition"): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface FakePty extends TtySeat {
  injected: string[];
  file: string;
}

/** A stub PTY behaving like the probed claude TUI: a bracketed paste parks
 * in the composer; the SEPARATE CR "submits" — the text lands as a user
 * record in that pane's OWN session jsonl. */
function makeFakePty(seat: string, projectRoot: string, file: string): FakePty {
  const subs = new Set<(ev: { data?: Buffer; exit?: { code: number } }) => void>();
  let pending: string | undefined;
  const tty: FakePty = {
    seat,
    projectRoot,
    agent: "claude",
    startedAtMs: Date.now(),
    outputBytesSince: () => 0, // quiet fake — the fixed-window verify contract
    cols: 120,
    rows: 32,
    blended: true,
    composerDirty: false,
    injected: [],
    file,
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

interface TeamRig {
  proj: string;
  home: string;
  inbox: string;
  claudeDir: string;
  /** Every pane ever spawned, per seat — respawns append. */
  ttys: Map<string, FakePty[]>;
  /** Pre-seeded assistant usage line for new session files (gauge fuel). */
  seedUsageTokens?: number;
  startTty: (o: StartTtyOpts) => Promise<StartTtyResult>;
}

function teamRig(name: string, conf: string): TeamRig {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state", "inbox"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), conf);
  const home = join(scratch, `${name}-home`);
  // ONE shared claude project dir for every seat — the all-seats reality.
  const claudeDir = join(home, ".claude", "projects", realpathSync(proj).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(claudeDir, { recursive: true });
  let seq = 0;
  const r: TeamRig = {
    proj,
    home,
    inbox: join(proj, ".agents", "state", "inbox"),
    claudeDir,
    ttys: new Map(),
    startTty: async (o) => {
      seq++;
      const file = join(claudeDir, `sess-${o.seat}-${seq}.jsonl`);
      writeFileSync(
        file,
        r.seedUsageTokens
          ? JSON.stringify({ type: "assistant", message: { usage: { input_tokens: r.seedUsageTokens, cache_read_input_tokens: 0, output_tokens: 5 } } }) + "\n"
          : "",
      );
      const tty = makeFakePty(o.seat, proj, file);
      const list = r.ttys.get(o.seat) ?? [];
      list.push(tty);
      r.ttys.set(o.seat, list);
      return { ok: true, tty, reattached: false };
    },
  };
  return r;
}

function makeSeat(r: TeamRig, seat: Seat, over: Partial<ConstructorParameters<typeof BlendedSeat>[0]> = {}): BlendedSeat {
  return new BlendedSeat({
    projectRoot: r.proj,
    seat,
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

const lastPaste = (t: FakePty) => t.injected.filter((s) => s.startsWith(PASTE_START)).at(-1);
const markerOf = (paste: string) => paste.match(/#([0-9a-f]{8})/)![1]!;

test("all-seats: two blended seats mail each other; each PINS its OWN session even when the other's file is newer; acks absorbed", async () => {
  const r = teamRig("team-mail", 'ORCH_AGENT="claude"\nBLEND_ORCH=1\nCODER_AGENT="claude"\nBLEND_CODER=1\n');
  const orch = makeSeat(r, "orchestrator");
  const coder = makeSeat(r, "coder");
  orch.start();
  coder.start();
  try {
    await waitFor(() => (r.ttys.get("orchestrator")?.length ?? 0) === 1 && (r.ttys.get("coder")?.length ?? 0) === 1, 5000, "both panes up");
    const orchPty = r.ttys.get("orchestrator")![0]!;
    const coderPty = r.ttys.get("coder")![0]!;
    // Make the CODER's session the NEWEST file in the shared dir — the exact
    // trap "newest wins" discovery falls into with an all-blended team.
    const future = (Date.now() + 1500) / 1000;
    utimesSync(coderPty.file, future, future);

    enqueue(r.inbox, "orchestrator", "operator", "kickoff: ship feature X");
    await waitFor(() => readNew(r.inbox, "orchestrator").length === 0, 5000, "orchestrator delivery");
    const sfOrch = JSON.parse(readFileSync(sessionFile(r.proj, "orchestrator"), "utf8"));
    assert.match(sfOrch.sessionId, /^sess-orchestrator-/, "pinned by MARKER to its own session — the decoy newer file did not win");
    const m = markerOf(lastPaste(orchPty)!);
    assert.ok(readFileSync(orchPty.file, "utf8").includes(`#${m}`), "delivery landed in the orchestrator's file");
    assert.ok(!readFileSync(coderPty.file, "utf8").includes(`#${m}`), "…and ONLY there");

    // The orchestrator's agent briefs the coder (what agentctl deliver does):
    // seat-to-seat mail flows through the same maildirs, engine-delivered.
    enqueue(r.inbox, "coder", "orchestrator", "Build feature X on branch feat/x; emit code_ready when green");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "coder delivery");
    assert.ok(lastPaste(coderPty)!.includes("Build feature X"), "the brief rode into the coder's live pane");
    const sfCoder = JSON.parse(readFileSync(sessionFile(r.proj, "coder"), "utf8"));
    assert.match(sfCoder.sessionId, /^sess-coder-/, "the coder pinned its own file too");
    assert.equal(r.ttys.get("orchestrator")!.length, 1, "the orchestrator PERSISTS — no respawn from cross-mail");

    // Ack chatter between blended seats is absorbed without waking a pane.
    const orchInjections = orchPty.injected.length;
    enqueue(r.inbox, "orchestrator", "coder", "Standing by, no further action.");
    await waitFor(() => readNew(r.inbox, "orchestrator").length === 0, 5000, "ack absorbed");
    assert.equal(orchPty.injected.length, orchInjections, "no injection for a pure seat-to-seat ack");
  } finally {
    orch.stop();
    coder.stop();
  }
});

test("all-seats: a task CLOSE resets blended WORKERS fresh (visible re-orientation) while the orchestrator persists", async () => {
  const r = teamRig("team-close", 'ORCH_AGENT="claude"\nBLEND_ORCH=1\nCODER_AGENT="claude"\nBLEND_CODER=1\n');
  // The real crew wiring: ONE events.log watcher + ONE shared tracker.
  const stale = blendCrewFor(r.proj).stale;
  const orch = makeSeat(r, "orchestrator", { stale });
  const coder = makeSeat(r, "coder", { stale });
  orch.start();
  coder.start();
  try {
    await waitFor(() => (r.ttys.get("orchestrator")?.length ?? 0) === 1 && (r.ttys.get("coder")?.length ?? 0) === 1, 5000, "both panes up");
    // Task 1 runs through both panes.
    enqueue(r.inbox, "coder", "orchestrator", "task 1 brief");
    enqueue(r.inbox, "orchestrator", "coder", "code_ready: task 1 built, gate green");
    await waitFor(() => readNew(r.inbox, "coder").length === 0 && readNew(r.inbox, "orchestrator").length === 0, 5000, "task 1 mail");

    // agentctl closes the loop — the crew's watcher marks resettable seats.
    appendFileSync(join(r.proj, ".agents", "state", "events.log"), `[${new Date().toISOString()}] CLOSE actor=orchestrator state=idle\n`);
    await waitFor(() => stale.isStale("coder"), 5000, "worker marked stale at CLOSE");
    assert.equal(stale.isStale("orchestrator"), false, "the orchestrator NEVER resets at a task boundary");

    // Task 2: the coder's next brief opens clean eyes, visibly re-oriented;
    // the orchestrator's next mail lands in the SAME session, mail alone.
    enqueue(r.inbox, "coder", "orchestrator", "task 2 brief — new feature");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "task 2 coder delivery");
    assert.equal(r.ttys.get("coder")!.length, 2, "the coder respawned FRESH");
    const freshPaste = lastPaste(r.ttys.get("coder")![1]!)!;
    assert.ok(freshPaste.includes("[fresh session — orient first]"), "the pane SHOWS the re-orientation");
    assert.ok(freshPaste.includes("task 2 brief"), "…with the new brief as the fresh session's first mail");
    assert.match(JSON.parse(readFileSync(sessionFile(r.proj, "coder"), "utf8")).sessionId, /^sess-coder-\d+$/);

    enqueue(r.inbox, "orchestrator", "operator", "how is task 2 going?");
    await waitFor(() => readNew(r.inbox, "orchestrator").length === 0, 5000, "orchestrator task 2 mail");
    assert.equal(r.ttys.get("orchestrator")!.length, 1, "one deep context, uninterrupted");
    assert.ok(!lastPaste(r.ttys.get("orchestrator")![0]!)!.includes("[fresh session"), "a persistent session gets mail alone");
  } finally {
    orch.stop();
    coder.stop();
  }
});

test("verify-dispatch fresh-eyes (agentctl e84bd0d) end-to-end: a dropped session.json = fresh respawn before the verify brief", async () => {
  const r = teamRig("team-fresheyes", 'REVIEWER_AGENT="claude"\nBLEND_REVIEWER=1\n');
  const reviewer = makeSeat(r, "reviewer");
  reviewer.start();
  try {
    await waitFor(() => (r.ttys.get("reviewer")?.length ?? 0) === 1, 5000, "pane up");
    enqueue(r.inbox, "reviewer", "orchestrator", "context: earlier discussion of feat/x");
    await waitFor(() => readNew(r.inbox, "reviewer").length === 0, 5000, "first delivery persists the session");
    assert.ok(existsSync(sessionFile(r.proj, "reviewer")));

    // What agentctl's refresh_verifier_session does at code_ready, BEFORE the
    // mail: rm turns/reviewer/session.json — the sanctioned fresh-start lever.
    rmSync(sessionFile(r.proj, "reviewer"));
    enqueue(r.inbox, "reviewer", "orchestrator", "VERIFY branch feat/x with fresh eyes");
    await waitFor(() => readNew(r.inbox, "reviewer").length === 0, 5000, "verify delivery");
    assert.equal(r.ttys.get("reviewer")!.length, 2, "the seat respawned FRESH — it cannot grade its own homework");
    const paste = lastPaste(r.ttys.get("reviewer")![1]!)!;
    assert.ok(paste.includes("[fresh session — orient first]") && paste.includes("VERIFY branch feat/x"));
    const log = readFileSync(join(r.proj, ".agents", "state", "turns", "reviewer", "turns.log"), "utf8");
    assert.match(log, /session\.json dropped by the fresh-start lever/);
    assert.match(JSON.parse(readFileSync(sessionFile(r.proj, "reviewer"), "utf8")).sessionId, /^sess-reviewer-2$/, "the NEW session persisted");
  } finally {
    reviewer.stop();
  }
});

test("CONTEXT_AUTO_REFRESH on a blended seat: over the ceiling → session dropped → the NEXT delivery is a visible fresh restart", async () => {
  const r = teamRig("team-autorefresh", 'CODER_AGENT="claude"; CODER_MODEL="opus"\nBLEND_CODER=1\nCONTEXT_AUTO_REFRESH=1\n');
  r.seedUsageTokens = 920_000; // opus window 1M (real, 2026-08-12 gauge fix) → 92% ≥ the 85% ceiling
  const coder = makeSeat(r, "coder", { contextAutoRefresh: true, model: "opus" });
  coder.start();
  try {
    await waitFor(() => (r.ttys.get("coder")?.length ?? 0) === 1, 5000, "pane up");
    enqueue(r.inbox, "coder", "orchestrator", "one more change on the huge task");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "delivery over the ceiling");
    // The INHERITED runnerLoop hook (one lever, both worlds) dropped the file.
    await waitFor(() => !existsSync(sessionFile(r.proj, "coder")), 5000, "ceiling drop");
    const log1 = readFileSync(join(r.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
    assert.match(log1, /auto-refreshed \| context 9\d% ≥ ceiling — session dropped/);

    enqueue(r.inbox, "coder", "orchestrator", "continue after the refresh");
    await waitFor(() => readNew(r.inbox, "coder").length === 0, 5000, "post-refresh delivery");
    assert.equal(r.ttys.get("coder")!.length, 2, "the refresh IS a visible restart");
    const paste = lastPaste(r.ttys.get("coder")![1]!)!;
    assert.ok(paste.includes("[fresh session — orient first]"), "…and the pane shows the re-orientation");
    const log2 = readFileSync(join(r.proj, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
    assert.match(log2, /session\.json dropped by the fresh-start lever/);
  } finally {
    coder.stop();
  }
});

// keep scratch until the process exits (node:test runs files in-process)
process.on("exit", () => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
