// Native seat access (PDR native-seat-access) — the pure parts under test:
// interactive argv per CLI, the attended/busy markers, the claude session
// re-point seam. The PTY itself is proven live (the gate), not mocked here.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildInteractiveInvocation,
  claudeProjectDir,
  newestClaudeSession,
  repointSessionAfterTty,
  ttySessionId,
} from "../src/ptyseat.js";
import { attendedFile, isAttended, isTurnActive, activeTurnFile, sessionFile, turnsDir } from "../src/runner.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "ptyseat-test-"));
}

// ── interactive argv (the second door opens the SAME session) ──

test("claude: seat identity + resume + model; bypass ONLY inside a wall (Adam, 2026-08-11)", () => {
  const walled = buildInteractiveInvocation("claude", { sessionId: "sid-1", model: "fable", walled: true, seat: "orchestrator" });
  assert.equal(walled[0], "claude");
  assert.equal(walled[1], "--append-system-prompt");
  assert.match(walled[2]!, /orchestrator seat/, "the wheel is born knowing WHO it is (flaw #9)");
  assert.match(walled[2]!, /NEVER produce the work/, "the orchestrator law survives the wheel");
  assert.deepEqual(walled.slice(3), ["--permission-mode", "bypassPermissions", "--model", "fable", "--resume", "sid-1"]);
  const bare = buildInteractiveInvocation("claude", { sessionId: "sid-1", model: "fable", seat: "coder" });
  assert.ok(!bare.includes("--permission-mode"), "no wall → no bypass, the walling law holds at the wheel");
  assert.match(bare[2]!, /coder seat/, "worker seats carry identity too, without the orchestrator law");
});

test("claude-code normalizes to the claude door", () => {
  assert.deepEqual(buildInteractiveInvocation("claude-code", {}), ["claude"]);
});

test("codex: resume-first; account-default model stays unset", () => {
  assert.deepEqual(buildInteractiveInvocation("codex", { sessionId: "th-9" }), ["codex", "resume", "th-9"]);
  assert.deepEqual(buildInteractiveInvocation("codex", {}), ["codex"]);
});

test("pi: provider/model split + shared --session-id", () => {
  const argv = buildInteractiveInvocation("pi", { sessionId: "u-1", model: "openai-codex/gpt-5.5" });
  assert.deepEqual(argv, ["pi", "--provider", "openai-codex", "--model", "gpt-5.5", "--session-id", "u-1"]);
});

test("an unwired agent refuses the door in plain words", () => {
  assert.throws(() => buildInteractiveInvocation("aider", {}), /no interactive door/);
});

// ── the shared session id (mirrors the runner's semantics) ──

test("ttySessionId reads the seat's session; pi pre-mints so both doors share", () => {
  const p = tmpProject();
  try {
    assert.equal(ttySessionId(p, "coder", "claude"), undefined, "claude first-open: fresh TUI, headless turn 1 pairs later");
    writeFileSync(sessionFile(p, "coder"), JSON.stringify({ agent: "claude", sessionId: "abc" }));
    assert.equal(ttySessionId(p, "coder", "claude"), "abc");
    assert.equal(ttySessionId(p, "coder", "codex"), undefined, "restaffed seat never resumes the other agent's session");
    const minted = ttySessionId(p, "tester", "pi");
    assert.ok(minted, "pi mints up front");
    assert.equal(JSON.parse(readFileSync(sessionFile(p, "tester"), "utf8")).sessionId, minted, "…and persists it for the runner");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── attended + busy markers (filesystem-visible across processes) ──

test("attended: live pid holds, dead pid self-cleans (never a hostage seat)", () => {
  const p = tmpProject();
  try {
    assert.equal(isAttended(p, "coder"), false);
    writeFileSync(attendedFile(p, "coder"), JSON.stringify({ pid: 12345 }));
    assert.equal(isAttended(p, "coder", () => true), true);
    assert.equal(isAttended(p, "coder", () => false), false, "owner died — hold releases");
    assert.equal(isAttended(p, "coder", () => true), false, "…and the stale marker is gone");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("busy: a live turn refuses the door; a stale lock does not", () => {
  const p = tmpProject();
  try {
    writeFileSync(activeTurnFile(p, "coder"), JSON.stringify({ pid: 999 }));
    assert.equal(isTurnActive(p, "coder", () => true), true);
    assert.equal(isTurnActive(p, "coder", () => false), false, "crashed runner never blocks the keys");
    assert.equal(isTurnActive(p, "coder", () => true), false, "stale lock cleaned");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── the claude handback seam ──

test("claudeProjectDir munges every non-alphanumeric to '-' (live-verified rule)", () => {
  assert.equal(
    claudeProjectDir("/mnt/data/projects/jdm-rush-crate", "/home/adam"),
    join("/home/adam", ".claude", "projects", "-mnt-data-projects-jdm-rush-crate"),
  );
});

test("newestClaudeSession: since-filter + newest wins; absent dir is undefined", () => {
  const d = mkdtempSync(join(tmpdir(), "claude-proj-"));
  try {
    const old = join(d, "old-session.jsonl");
    const fresh = join(d, "fresh-session.jsonl");
    writeFileSync(old, "{}\n");
    writeFileSync(fresh, "{}\n");
    const t0 = Date.now();
    utimesSync(old, new Date(t0 - 60_000), new Date(t0 - 60_000));
    utimesSync(fresh, new Date(t0), new Date(t0));
    assert.equal(newestClaudeSession(d, t0 - 10_000), "fresh-session");
    assert.equal(newestClaudeSession(d, t0 + 10_000), undefined, "nothing touched since = no re-point");
    assert.equal(newestClaudeSession(join(d, "nope"), 0), undefined);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("repointSessionAfterTty: the human-driven fork becomes the seat's session", () => {
  const p = tmpProject();
  const home = mkdtempSync(join(tmpdir(), "home-"));
  try {
    writeFileSync(sessionFile(p, "coder"), JSON.stringify({ agent: "claude", sessionId: "pre-drop-in" }));
    const projDir = claudeProjectDir(p, home);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "forked-id.jsonl"), "{}\n");
    const sid = repointSessionAfterTty(p, "coder", "claude", Date.now() - 5_000, home);
    assert.equal(sid, "forked-id");
    assert.equal(JSON.parse(readFileSync(sessionFile(p, "coder"), "utf8")).sessionId, "forked-id");
    assert.equal(
      repointSessionAfterTty(p, "coder", "claude", Date.now() - 5_000, home),
      undefined,
      "same session again = no-op (idempotent)",
    );
    assert.equal(repointSessionAfterTty(p, "coder", "pi", 0, home), undefined, "codex/pi: ids stable, no re-point");
  } finally {
    rmSync(p, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the runner writes the busy marker for exactly the turn's duration ──

test("runTurn holds active.lock while the harness runs, clears it after", async () => {
  const p = tmpProject();
  try {
    // one unread message so a real turn runs; the "harness" is a shell sleep
    const { enqueue } = await import("../src/mailbox.js");
    enqueue(join(p, ".agents", "state", "inbox"), "coder", "orchestrator", "do the thing");
    const { runTurn } = await import("../src/runner.js");
    const turn = runTurn({
      projectRoot: p,
      seat: "coder",
      agent: "pi",
      invocationOverride: () => ({ argv: ["sleep", "0.4"], stdin: "ignore" }),
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(isTurnActive(p, "coder"), true, "mid-turn: the door must read busy");
    await turn;
    assert.equal(isTurnActive(p, "coder"), false, "turn done: the keys are free");
    // the maildir layout here is a fixture; completion semantics live in runner.test.ts
    void turnsDir;
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── eviction (blend relaunch lesson, live proof 2026-08-12) ──

test("evictSeatTty: a relaunch can never reattach a dying pane, and its late exit never unregisters the successor", async () => {
  const p = tmpProject();
  try {
    const { startSeatTty, evictSeatTty, liveTty } = await import("../src/ptyseat.js");
    const a = await startSeatTty({ projectRoot: p, seat: "coder", agent: "pi", blended: true, argvOverride: ["sleep", "5"] });
    assert.ok(a.ok && !a.reattached, "first spawn is fresh");
    // Evict: gone from the registry NOW, while the process is still dying —
    // the exact window where the D12-refresh successor spawns.
    assert.equal(evictSeatTty(p, "coder"), true);
    assert.equal(liveTty(p, "coder"), undefined, "evicted: a successor must not find the dying pane");
    const b = await startSeatTty({ projectRoot: p, seat: "coder", agent: "pi", blended: true, argvOverride: ["sleep", "5"] });
    assert.ok(b.ok && !b.reattached, "the successor spawns FRESH — the refresh restart is visible immediately");
    // The evicted pane's LATE exit must not unregister the successor (guarded delete).
    if (a.ok) {
      await new Promise<void>((res) => {
        if (a.tty.exited) return res();
        a.tty.subscribe((ev) => {
          if (ev.exit) res();
        });
      });
    }
    assert.ok(b.ok && liveTty(p, "coder") === b.tty, "late exit of the evicted pane left the successor registered");
    evictSeatTty(p, "coder"); // cleanup: kill the successor's stub process too
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── output-activity probe (turn-boundary verify, 2026-08-13) ──

test("outputBytesSince: recent pane output counts; an old burst ages out of the window", async () => {
  const p = tmpProject();
  try {
    const { startSeatTty, evictSeatTty } = await import("../src/ptyseat.js");
    const r = await startSeatTty({
      projectRoot: p, seat: "coder", agent: "pi", blended: true,
      argvOverride: ["bash", "-c", "printf 'streaming-output-burst-%s ' 1 2 3 4 5; sleep 5"],
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    await new Promise((res) => setTimeout(res, 400)); // let the burst land
    assert.ok(r.tty.outputBytesSince(60_000) >= 50, "the burst is visible in a wide window");
    await new Promise((res) => setTimeout(res, 700));
    assert.equal(r.tty.outputBytesSince(300), 0, "…and invisible in a window newer than the burst");
    evictSeatTty(p, "coder");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── pane-pid registry (Pack 2: badge absence ≠ humanity) ──

test("the PTY door registers the pane's pid (pty.json) at spawn and clears it on exit", async () => {
  const p = tmpProject();
  try {
    const { startSeatTty, evictSeatTty } = await import("../src/ptyseat.js");
    const r = await startSeatTty({ projectRoot: p, seat: "coder", agent: "pi", blended: true, argvOverride: ["sleep", "5"] });
    assert.ok(r.ok && !r.reattached);
    const f = join(p, ".agents", "state", "turns", "coder", "pty.json");
    const reg = JSON.parse(readFileSync(f, "utf8")) as { pid: number; atMs: number };
    assert.ok(reg.pid > 0, "the live pane's pid is on record for agentctl's ancestor tripwire");
    assert.ok(Math.abs(Date.now() - reg.atMs) < 60_000, "spawn time recorded (the pid-reuse guard reads it)");
    evictSeatTty(p, "coder"); // kill → exit clears the registry
    if (r.ok) {
      await new Promise<void>((res) => {
        if (r.tty.exited) return res();
        r.tty.subscribe((ev) => {
          if (ev.exit) res();
        });
      });
    }
    assert.equal(existsSync(f), false, "a dead pane leaves no registry entry behind");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

// ── Multi-view sizing (FLAWS 2026-08-12): smallest-client-wins, tmux's model
// — the view's STREAM is its liveness (Adam, 2026-08-14: no heartbeats, no
// TTL); a closed stream drops its proposal and the survivors apply NOW ──

test("two views of one PTY: the smallest live proposal wins each dimension; a dropped view releases its clamp INSTANTLY", async () => {
  const p = tmpProject();
  try {
    const { startSeatTty, evictSeatTty } = await import("../src/ptyseat.js");
    const r = await startSeatTty({
      projectRoot: p, seat: "coder", agent: "pi", blended: true,
      argvOverride: ["sleep", "10"],
    });
    if (!r.ok) throw new Error("no tty: " + JSON.stringify(r));
    const tty = r.tty;
    tty.resize(120, 40, "grid.1");
    assert.equal(tty.cols, 120);
    assert.equal(tty.rows, 40);
    tty.resize(80, 50, "popped.1"); // smaller cols, LARGER rows — min per dimension
    assert.equal(tty.cols, 80, "cols clamp to the smallest view (the second cockpit)");
    assert.equal(tty.rows, 40, "rows clamp to the smallest view (the grid)");
    tty.resize(120, 40, "grid.1"); // the big view re-fits — still clamped by the other
    assert.equal(tty.cols, 80, "last-writer-wins is dead: the other view's proposal still binds");
    tty.dropSizeProposal("popped.1"); // its stream closed — the server calls this
    assert.equal(tty.cols, 120, "the clamp releases the INSTANT the stream closes — no timer, no wait");
    assert.equal(tty.rows, 40);
    tty.dropSizeProposal("grid.1"); // last view gone — the size just stands
    assert.equal(tty.cols, 120, "no proposals left → nothing moves");
    // the reopen race: the OLD generation's close can never erase the NEW
    // generation's proposal (per-stream keys — the reopen is invisible)
    tty.resize(100, 30, "grid.2");
    tty.dropSizeProposal("grid.1"); // stale close lands late
    assert.equal(tty.cols, 100, "a late old-generation close is inert");
    assert.equal(tty.rows, 30);
    // a CLIENT-LESS call stays the legacy direct path (tests/tools)
    tty.resize(77, 33);
    assert.equal(tty.cols, 77);
    assert.equal(tty.rows, 33);
    evictSeatTty(p, "coder");
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});
