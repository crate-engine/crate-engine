// FLAWS 2026-08-11 "runner-deaths" — the battle-test relaunch killed four of
// five runners silently and left the fifth immortal. Three proven gaps, three
// regression walls:
//   1. /api/restart abandoned the team (plain process.exit → no cleanup, no
//      EXIT stamps) — now handoffStop() stops the seats while the parent is
//      alive and restartArgv() carries --boot iff the team was running.
//   2. The orphan watchdog captured ppid AFTER boot work, so a supervisor
//      dying mid-boot was adopted as ppid0 = init — the immortal orphan. The
//      spawner now pins CRATE_SUPERVISOR_PID before the child starts.
//   3. Watchdog exits had no forensic trail (the parent that wrote EXIT stamps
//      was dead) — the orphan now self-stamps its runner log + gui.log.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSeatSpawner, handoffStop, teamProcessFor, type SeatSpawner } from "../src/gui/teamproc.js";
import { restartArgv } from "../src/gui/server.js";
import { runnerLoop } from "../src/runner.js";

function rig(prefix: string): string {
  const p = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(p, ".agents", "state", "inbox"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=x\n");
  return p;
}

// Inert real children so pid/alive/SIGTERM are genuine (the teamproc.test.ts pattern).
const stubSpawner: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

// ── gap 2: the immortal-orphan race ─────────────────────────────────────────

test("runnerLoop with supervisorPid EXITS even when ppid was 1 from the very start (immortal-orphan regression)", async () => {
  const projectRoot = rig("crate-immortal-");
  const home = mkdtempSync(join(tmpdir(), "crate-immortal-home-"));
  // The killer window: the supervisor died during our boot, so by the time the
  // loop starts we are ALREADY reparented — getPpid never changes again. The
  // old captured-ppid0 logic adopted 1 as the parent and looped forever; with
  // the spawner-pinned supervisorPid the first iteration must exit.
  await runnerLoop({
    projectRoot,
    seat: "coder",
    agent: "pi",
    home,
    supervisorPid: 4242,
    getParentPid: () => 1,
  });
  const log = readFileSync(join(projectRoot, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
  assert.match(log, /orphaned — supervisor \(pid 4242\) is gone; runner exiting/);
});

test("runnerLoop with a MATCHING supervisorPid keeps looping (no false orphan)", async () => {
  const projectRoot = rig("crate-super-alive-");
  const home = mkdtempSync(join(tmpdir(), "crate-super-alive-home-"));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  await runnerLoop({
    projectRoot,
    seat: "coder",
    agent: "pi",
    home,
    pollMs: 50,
    supervisorPid: 4242,
    getParentPid: () => 4242, // supervisor stays alive the whole run
    signal: ac.signal,
  });
  // The loop ran idle turns until the abort — it must NOT have orphan-exited.
  const turns = join(projectRoot, ".agents", "state", "turns", "coder", "turns.log");
  let log = "";
  try {
    log = readFileSync(turns, "utf8");
  } catch {
    /* no turns.log at all = certainly no orphan note */
  }
  assert.doesNotMatch(log, /orphaned/);
});

// ── gap 3: the forensic self-stamp ──────────────────────────────────────────

test("orphan exit SELF-stamps the runner log and gui.log (the dead parent cannot)", async () => {
  const projectRoot = rig("crate-orphan-stamp-");
  const home = mkdtempSync(join(tmpdir(), "crate-orphan-stamp-home-"));
  await runnerLoop({
    projectRoot,
    seat: "reviewer",
    agent: "pi",
    home,
    supervisorPid: 9999,
    getParentPid: () => 1,
  });
  const seatLog = readFileSync(join(home, ".crate", "logs", "runners", "reviewer.log"), "utf8");
  assert.match(seatLog, /runner reviewer orphan-exit — supervisor 9999 gone/);
  const guiLog = readFileSync(join(home, ".crate", "logs", "gui.log"), "utf8");
  assert.match(guiLog, /runner reviewer orphan-exit — supervisor 9999 gone/);
});

// ── gap 1: the restart handoff ──────────────────────────────────────────────

test("handoffStop stops a booted team while the parent is alive and reports it (wasBooted, 5 seats)", async () => {
  const p = rig("crate-handoff-");
  const tp = teamProcessFor(p, stubSpawner);
  tp.boot();
  const handoff = handoffStop();
  assert.equal(handoff.wasBooted, true, "a running team is reported for the --boot handoff");
  assert.equal(handoff.stopped, 5, "all five seats were stopped");
  await new Promise((r) => setTimeout(r, 150)); // let SIGTERM land
  assert.ok(tp.status().seats.every((s) => !s.alive), "every seat is dead after the handoff stop");
  // The registry was cleared: a second handoff finds nothing running.
  assert.deepEqual(handoffStop(), { wasBooted: false, stopped: 0 });
});

test("handoffStop on a never-booted team reports wasBooted:false (no --boot for an idle rig)", () => {
  const p = rig("crate-handoff-idle-");
  teamProcessFor(p, stubSpawner); // registered but never booted
  assert.deepEqual(handoffStop(), { wasBooted: false, stopped: 0 });
});

test("restartArgv carries --boot IFF the team was running, and --project only when attached", () => {
  const withBoot = restartArgv({ cliPath: "/x/cli.js", project: "/proj" }, "/tmp/u", true);
  assert.deepEqual(withBoot, ["/x/cli.js", "gui", "--url-file", "/tmp/u", "--project", "/proj", "--boot"]);
  const noBoot = restartArgv({ cliPath: "/x/cli.js", project: "/proj" }, "/tmp/u", false);
  assert.ok(!noBoot.includes("--boot"), "an idle team never triggers an auto-boot");
  const noProject = restartArgv({ cliPath: "/x/cli.js" }, "/tmp/u", false);
  assert.deepEqual(noProject, ["/x/cli.js", "gui", "--url-file", "/tmp/u"]);
});

// ── the spawner pins the supervisor pid before the child starts ─────────────

test("defaultSeatSpawner hands the child CRATE_SUPERVISOR_PID = this process's pid", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "crate-spawner-env-"));
  // Stub "cli" that just records the env var the watchdog will trust.
  const cliStub = join(projectRoot, "cli-stub.cjs");
  writeFileSync(cliStub, `require("node:fs").writeFileSync("sup.txt", String(process.env.CRATE_SUPERVISOR_PID ?? "missing"));`);
  const child = defaultSeatSpawner(cliStub)("coder", projectRoot);
  await new Promise<void>((res) => child.on("exit", () => res()));
  assert.equal(readFileSync(join(projectRoot, "sup.txt"), "utf8"), String(process.pid));
});
