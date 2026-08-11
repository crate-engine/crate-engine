// Native seat access (PDR native-seat-access) — the pure parts under test:
// interactive argv per CLI, the attended/busy markers, the claude session
// re-point seam. The PTY itself is proven live (the gate), not mocked here.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

test("claude: resume + model ride the interactive argv; bypass ONLY inside a wall (Adam, 2026-08-11)", () => {
  const walled = buildInteractiveInvocation("claude", { sessionId: "sid-1", model: "fable", walled: true });
  assert.deepEqual(walled, ["claude", "--permission-mode", "bypassPermissions", "--model", "fable", "--resume", "sid-1"]);
  const bare = buildInteractiveInvocation("claude", { sessionId: "sid-1", model: "fable" });
  assert.ok(!bare.includes("--permission-mode"), "no wall → no bypass, the walling law holds at the wheel");
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
