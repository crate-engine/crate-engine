// PHASE-8 T7-3 — the team lifecycle manager (GUI owns the headless team).
// Driven with a STUB spawner (a short-lived `sleep` child) so boot/stop/
// relaunch/status are provable without real runners or tokens.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TeamProcess, teamProcessFor, stopAllTeams, type SeatSpawner } from "../src/gui/teamproc.js";
import type { Seat } from "../src/manifest.js";

function rig(): string {
  const p = mkdtempSync(join(tmpdir(), "teamproc-"));
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=x\n");
  return p;
}

// Each "seat" is a real but inert child (sleep) so pid/alive are genuine.
const stubSpawner: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

test("boot spawns one live child per seat; status reports all five alive", () => {
  const p = rig();
  const tp = new TeamProcess(p, stubSpawner);
  try {
    const st = tp.boot();
    assert.equal(st.booted, true);
    assert.equal(st.seats.length, 5);
    assert.ok(st.seats.every((s) => s.alive && s.pid), "every seat alive with a pid");
  } finally {
    tp.stop();
  }
});

test("boot is idempotent — a second boot does not double-spawn a live seat", () => {
  const p = rig();
  const tp = new TeamProcess(p, stubSpawner);
  try {
    const pids1 = tp.boot().seats.map((s) => s.pid);
    const pids2 = tp.boot().seats.map((s) => s.pid);
    assert.deepEqual(pids2, pids1, "live seats keep their pids across a re-boot");
  } finally {
    tp.stop();
  }
});

test("relaunch restarts EXACTLY one seat (new pid), leaves the others", async () => {
  const p = rig();
  const tp = new TeamProcess(p, stubSpawner);
  try {
    const before = tp.boot().seats;
    const coderBefore = before.find((s) => s.seat === "coder")!.pid;
    const reviewerBefore = before.find((s) => s.seat === "reviewer")!.pid;
    const after = tp.relaunch("coder" as Seat).seats;
    assert.notEqual(after.find((s) => s.seat === "coder")!.pid, coderBefore, "coder got a new pid");
    assert.equal(after.find((s) => s.seat === "reviewer")!.pid, reviewerBefore, "reviewer untouched");
  } finally {
    tp.stop();
  }
});

test("stop kills every seat; status → not booted", async () => {
  const p = rig();
  const tp = new TeamProcess(p, stubSpawner);
  try {
    tp.boot();
    tp.stop();
    // give SIGTERM a tick to land
    await new Promise((r) => setTimeout(r, 150));
    const st = tp.status();
    assert.equal(st.booted, false);
    assert.ok(st.seats.every((s) => !s.alive), "no seat alive after stop");
  } finally {
    tp.stop();
  }
});

test("boot REFUSES a project with no rig.conf (attach first), plainly", () => {
  const p = mkdtempSync(join(tmpdir(), "teamproc-bare-"));
  const tp = new TeamProcess(p, stubSpawner);
  try {
    assert.throws(() => tp.boot(), /no rig\.conf.*attach/is);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("teamProcessFor returns the same supervisor per project (shared across requests)", () => {
  const p = rig();
  try {
    assert.equal(teamProcessFor(p, stubSpawner), teamProcessFor(p, stubSpawner));
  } finally {
    stopAllTeams();
  }
});
