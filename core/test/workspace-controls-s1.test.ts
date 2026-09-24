// Workspace Controls S1 (PDR dev/pdr/workspace-controls.md, Adam 2026-09-24):
// "if it's stopped or archived, there's nothing running in the background."
// Drives REAL processes: a seat-shaped child that plants a DETACHED grandchild
// (the CE-188 browser-daemon shape — PPID 1 once its parent exits) carrying the
// CRATE_PROJECT tag every seat process now inherits (runner.ts seatEnv).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { startGuiServer } from "../src/gui/server.js";
import { listTagged, sweepStopped, tagFromPsLine, taggedFor, teardownWorkspace, canonProject } from "../src/gui/reap.js";
import { stopAllTeams, type SeatSpawner } from "../src/gui/teamproc.js";
import { registerWorkspace, setWorkspaceDesired } from "../src/gui/workspaces.js";
import { seatEnv } from "../src/runner.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "wc-s1-")));
const spawned: ChildProcess[] = [];

function rig(name: string): string {
  const p = join(scratch, "repos", name);
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT=${name}\nBLEND_ORCH=0\nBLEND_CODER=0\nBLEND_REVIEWER=0\nBLEND_DESIGNER=0\nBLEND_TESTER=0\n`);
  return p;
}

// NODE stand-ins, not sleep/sh: macOS will not show the environment of its own
// platform binaries (sleep, sh, zsh, bash) even to the same user — real seat
// processes (node, claude, pi, chrome, next) are readable. A seat-shaped node
// process that spawns a DETACHED node grandchild (the daemon shape) and lingers.
const SEATLIKE = `const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { detached: true, stdio: "ignore" }).unref();
setTimeout(() => {}, 300000);`;

/** A tagged process that also leaves a DETACHED tagged grandchild behind. */
function plant(project: string, extraEnv: Record<string, string> = {}): ChildProcess {
  const c = spawn(process.execPath, ["-e", SEATLIKE], {
    env: { ...process.env, CRATE_PROJECT: project, ...extraEnv },
    stdio: "ignore",
    detached: true,
  });
  c.unref();
  spawned.push(c);
  return c;
}

const settle = () => new Promise((r) => setTimeout(r, 900)); // node stand-ins boot + spawn their daemon

after(async () => {
  stopAllTeams();
  // belt + braces: nothing this file planted may outlive it (CE-188's lesson)
  const mine = listTagged().filter((t) => t.project.startsWith(scratch));
  for (const t of mine) {
    try {
      process.kill(t.pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
});

test("seatEnv tags every seat process with its workspace (both doors inherit it)", () => {
  const env = seatEnv("/some/rig", "coder");
  assert.equal(env.CRATE_PROJECT, "/some/rig");
  assert.equal(env.CRATE_SEAT, "coder");
});

test("the macOS ps -E parser reads the tag, including a path with spaces", () => {
  assert.equal(tagFromPsLine("sleep 300 PATH=/bin CRATE_PROJECT=/Users/a/My Rigs/x HOME=/Users/a"), "/Users/a/My Rigs/x");
  assert.equal(tagFromPsLine("node x.js CRATE_PROJECT=/r/y"), "/r/y");
  assert.equal(tagFromPsLine("node x.js HOME=/h"), undefined);
});

test("teardown closes EVERY process tagged to the workspace — detached ones too — and nothing else", async () => {
  const a = rig("alpha-td");
  const b = rig("beta-td");
  plant(a);
  plant(b);
  const env = { ...process.env };
  delete env.CRATE_PROJECT;
  const untagged = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore", env });
  spawned.push(untagged);
  await settle();
  assert.equal(taggedFor(a).length, 2, "the seat-shaped child AND its detached grandchild carry alpha's tag");

  const r = await teardownWorkspace(a, { skipDevServer: true, graceMs: 2000 });
  assert.equal(r.closed, 2);
  assert.equal(r.remaining, 0, "stopped means zero");
  assert.equal(taggedFor(a).length, 0);
  assert.equal(taggedFor(b).length, 2, "another workspace's processes are untouched");
  assert.ok(untagged.pid && (() => { try { process.kill(untagged.pid!, 0); return true; } catch { return false; } })(), "an untagged process (the operator's own) is untouched");
  untagged.kill("SIGKILL");
  await teardownWorkspace(b, { skipDevServer: true, graceMs: 2000 });
});

test("the sweep closes only workspaces on the stopped list, and never a `crate team` (self-hosted) seat", async () => {
  const stoppedRig = rig("gamma-sw");
  const runningRig = rig("delta-sw");
  const selfHostedRig = rig("eps-sw");
  plant(stoppedRig);
  plant(runningRig);
  plant(selfHostedRig, { CRATE_SELF_HOSTED: "1" });
  await settle();
  const swept = await sweepStopped(new Set([canonProject(stoppedRig), canonProject(selfHostedRig)]), 2000);
  assert.deepEqual(swept.map((s) => [s.project, s.closed]), [[canonProject(stoppedRig), 2]]);
  assert.equal(taggedFor(stoppedRig).length, 0);
  assert.equal(taggedFor(runningRig).length, 2, "a running workspace is never swept");
  assert.equal(taggedFor(selfHostedRig).length, 2, "a crate-team (self-hosted) seat is never swept");
  await teardownWorkspace(runningRig, { skipDevServer: true, graceMs: 2000 });
  await teardownWorkspace(selfHostedRig, { skipDevServer: true, graceMs: 2000 });
});

// ── through the real server ─────────────────────────────────────────────────

/** A stub seat spawner shaped like the real one: the seat's env carries the tag
 * and the seat leaves a detached grandchild (a daemon it started). */
const leakyStub: SeatSpawner = (_seat, projectRoot) => {
  const c = spawn(process.execPath, ["-e", SEATLIKE], {
    env: { ...process.env, CRATE_PROJECT: projectRoot },
    stdio: "ignore",
  });
  spawned.push(c);
  return c;
};

async function server(home: string) {
  const gui = await startGuiServer({ home, seatSpawner: leakyStub });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${gui.port}${path}`, {
      method,
      headers: { "X-Crate-Token": gui.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
  };
  return { gui, call };
}

test("Stop through the app: the team AND everything it left behind are gone — and the response proves it", async () => {
  const home = join(scratch, "home-stop");
  mkdirSync(join(home, ".crate"), { recursive: true });
  const p = rig("zeta-stop");
  const { gui, call } = await server(home);
  try {
    assert.equal((await call("POST", "/api/workspaces/open", { path: p })).body.alive, 5);
    await settle();
    assert.equal(taggedFor(p).length, 10, "5 seats + 5 detached daemons");
    const r = await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.teardown.remaining, 0, "Stop reports 0 processes left");
    assert.equal(taggedFor(p).length, 0, "and the inventory agrees");
    assert.match(readFileSync(join(home, ".crate", "logs", "gui.log"), "utf8"), /stop: .*zeta-stop — closed \d+, 0 left/);
  } finally {
    await new Promise((r) => gui.server.close(r));
  }
});

test("Removing a RUNNING workspace stops it first — no agent is ever left running, invisible", async () => {
  const home = join(scratch, "home-remove");
  mkdirSync(join(home, ".crate"), { recursive: true });
  const p = rig("eta-remove");
  const { gui, call } = await server(home);
  try {
    await call("POST", "/api/workspaces/open", { path: p });
    await settle();
    assert.ok(taggedFor(p).length > 0);
    const r = await call("POST", "/api/workspaces/remove", { path: p });
    assert.equal(r.status, 200);
    assert.ok(!r.body.workspaces.some((w: any) => w.path === p), "off the list");
    assert.equal(taggedFor(p).length, 0, "and nothing of it still runs");
  } finally {
    await new Promise((r) => gui.server.close(r));
  }
});

test("server start sweeps leftovers of a STOPPED workspace (a crash, an old engine) and leaves running ones", async () => {
  const home = join(scratch, "home-sweep");
  mkdirSync(join(home, ".crate"), { recursive: true });
  const parked = rig("theta-parked");
  registerWorkspace(home, parked);
  setWorkspaceDesired(home, parked, "parked");
  plant(parked);
  await settle();
  assert.equal(taggedFor(parked).length, 2);
  const { gui } = await server(home);
  try {
    assert.equal(taggedFor(parked).length, 0, "the start-up sweep closed the leftovers");
    assert.match(readFileSync(join(home, ".crate", "logs", "gui.log"), "utf8"), /sweep: .*theta-parked is not running — closed 2/);
  } finally {
    await new Promise((r) => gui.server.close(r));
  }
});

test("a restart REPAIRS a workspace whose state predates the engine (CE-178, no special door)", async () => {
  const home = join(scratch, "home-heal");
  mkdirSync(join(home, ".crate"), { recursive: true });
  symlinkSync(REPO, join(home, ".crate", "engine")); // the real engine: templates/, bin/, config/
  const p = rig("iota-heal");
  mkdirSync(join(p, ".agents", "state"), { recursive: true });
  writeFileSync(join(p, ".agents", "state", "events.log"), "[2026-07-03T15:17:39] GATE_PASS actor=coder\n");
  for (const part of ["bin", "config", "adapters"]) symlinkSync("/nonexistent/old-engine/" + part, join(p, ".agents", part));
  registerWorkspace(home, p);
  setWorkspaceDesired(home, p, "running");
  const { gui } = await server(home);
  try {
    assert.ok(existsSync(join(p, ".agents", "state", "session.md")), "session.md seeded by the restart itself");
    assert.equal(readFileSync(join(p, ".agents", "state", "events.log"), "utf8"), "[2026-07-03T15:17:39] GATE_PASS actor=coder\n", "history untouched");
    assert.ok(existsSync(join(p, ".agents", "bin", "agentctl.py")), "the dangling engine links were re-pointed");
    assert.match(readFileSync(join(home, ".crate", "logs", "gui.log"), "utf8"), /heal: .*iota-heal — /);
  } finally {
    await new Promise((r) => gui.server.close(r));
  }
});
