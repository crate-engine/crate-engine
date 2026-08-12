// PHASE-B #1 — the silent-death fixes from the testuser8 human run: the gui
// server gets a black box (~/.crate/logs/gui.log), runners exit when their
// supervisor dies (ppid watchdog), and the cockpit says "engine offline"
// instead of freezing on stale state.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { guiLog, guiLogPath, openGuiLogFd } from "../src/gui/guilog.js";
import { teamPage } from "../src/gui/teampage.js";
import { runnerLoop } from "../src/runner.js";

test("guiLog writes a timestamped line to ~/.crate/logs/gui.log (creating dirs)", () => {
  const home = mkdtempSync(join(tmpdir(), "crate-guilog-"));
  guiLog(home, "serving on port 12345 (pid 999)");
  const p = guiLogPath(home);
  assert.ok(existsSync(p), "gui.log exists");
  const line = readFileSync(p, "utf8");
  assert.match(line, /^\[\d{4}-\d{2}-\d{2}T.*\] serving on port 12345 \(pid 999\)\n$/);
});

test("openGuiLogFd hands the spawner an appendable fd on the same file", () => {
  const home = mkdtempSync(join(tmpdir(), "crate-guilog-"));
  const fd = openGuiLogFd(home);
  assert.ok(typeof fd === "number" && fd > 0, "got a real fd");
  assert.ok(existsSync(guiLogPath(home)), "log file created for the child's stdio");
});

test("runnerLoop exits when its supervisor dies (ppid watchdog) and leaves an honest note", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "crate-orphan-"));
  mkdirSync(join(projectRoot, ".agents", "state", "inbox"), { recursive: true });
  // First call captures the supervisor pid; the next poll sees a new parent
  // (the OS reparented us = supervisor is gone) — the loop must return, never
  // reaching a turn.
  let calls = 0;
  const home = mkdtempSync(join(tmpdir(), "crate-orphan-home-")); // injected: the self-stamp must not hit the dev's real ~/.crate
  await runnerLoop({
    projectRoot,
    seat: "coder",
    agent: "pi",
    home,
    getParentPid: () => (calls++ === 0 ? 4242 : 1),
  });
  const log = readFileSync(join(projectRoot, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /orphaned — supervisor \(pid 4242\) is gone; runner exiting/);
});

test("cockpit page carries the dead-server banner and flips it on failed polls", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(html.includes('id="deadbar"'), "banner element present");
  assert.ok(/engine offline/i.test(html), "honest offline wording");
  assert.ok(html.includes("crate open"), "recovery command named");
  assert.ok(html.includes("POLLFAILS"), "poll-failure counter wired");
  assert.ok(html.includes('classList.add("dead")'), "failed polls flip the dead state");
  assert.ok(html.includes('classList.remove("dead")'), "a healthy poll clears it");
});
