// Workspace Controls S2–S4 — engine side (PDR dev/pdr/workspace-controls.md,
// Adam 2026-09-24). Through the REAL server: the "where we left off" note on
// every Stop, Resume fresh (clean sessions + the orchestrator told to read the
// note), Archive / Restore, the busy + memory + restart-needed facts every menu
// reads, and the one action route that works for any computer.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { composeLeftOff, seatSummary } from "../src/leftoff.js";
import { startGuiServer } from "../src/gui/server.js";
import { workspaceActionRequest } from "../src/gui/fleet.js";
import { listTagged } from "../src/gui/reap.js";
import { stopAllTeams, TeamProcess, type SeatSpawner } from "../src/gui/teamproc.js";
import { sessionFile } from "../src/runner.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "wc-s24-")));
const HOME = join(scratch, "home");
mkdirSync(join(HOME, ".crate"), { recursive: true });
symlinkSync(REPO, join(HOME, ".crate", "engine")); // real engine: bin/agentctl.py for the engine's own mail

function rig(name: string): string {
  const p = join(scratch, "repos", name);
  mkdirSync(join(p, ".agents", "state"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT=${name}\nBLEND_ORCH=0\nBLEND_CODER=0\nBLEND_REVIEWER=0\nBLEND_DESIGNER=0\nBLEND_TESTER=0\n`);
  for (const part of ["bin", "config", "adapters"]) symlinkSync(join(REPO, part), join(p, ".agents", part));
  execFileSync("git", ["init", "-q"], { cwd: p });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "first"], { cwd: p });
  writeFileSync(join(p, ".agents", "state", "events.log"), "[2026-09-24T09:00:00-05:00] START_IMPL actor=orchestrator branch=feature/x state=implementing\n");
  writeFileSync(join(p, ".agents", "state", "coder.md"), "# coder\n\n## Now\nwiring the login form\n\n## Next\nemit code_ready\n");
  return p;
}

const SEATLIKE = "setTimeout(() => {}, 300000);";
const spawned: ChildProcess[] = [];
const stub: SeatSpawner = (_seat, projectRoot) => {
  const c = spawn(process.execPath, ["-e", SEATLIKE], { env: { ...process.env, CRATE_PROJECT: projectRoot }, stdio: "ignore" });
  spawned.push(c);
  return c;
};

after(() => {
  stopAllTeams();
  for (const t of listTagged().filter((x) => x.project.startsWith(scratch))) {
    try {
      process.kill(t.pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
});

let gui: Awaited<ReturnType<typeof startGuiServer>>;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${gui.port}${path}`, {
    method,
    headers: { "X-Crate-Token": gui.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

test("the note: each seat's own Now/Next, the loop state, the code — composed from ground truth", () => {
  const p = rig("note-unit");
  const note = composeLeftOff(p, new Date(2026, 8, 24, 10, 30));
  assert.match(note, /^# Where we left off — note-unit/);
  assert.match(note, /Stopped 2026-09-24 10:30/);
  assert.match(note, /State: implementing — last task\/branch: feature\/x/);
  assert.match(note, /\*\*coder\*\*\n {2}Now:\n {4}wiring the login form\n {2}Next:\n {4}emit code_ready/);
  assert.match(note, /Checkout: .* @ \w+ first/);
  assert.deepEqual(seatSummary("status: idle\nnoise"), ["status: idle"]);
});

test("Stop writes the note, reports what it interrupted, and proves zero", async () => {
  gui = await startGuiServer({ home: HOME, seatSpawner: stub });
  const p = rig("stop-note");
  assert.equal((await call("POST", "/api/workspaces/open", { path: p })).body.alive, 5);
  const r = await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.interrupted, [], "nothing was mid-task");
  assert.equal(r.body.teardown.remaining, 0);
  assert.ok(existsSync(join(p, ".agents", "state", "checkpoints", "LEFT-OFF.md")), "the note is on disk");
  assert.equal(readdirSync(join(p, ".agents", "state", "checkpoints", "archive")).filter((f) => f.startsWith("left-off-")).length, 1, "and an archive copy");
});

test("Resume fresh: refused on a running workspace; on a stopped one every session is dropped and the orchestrator is told to read the note", async () => {
  const p = rig("fresh");
  await call("POST", "/api/workspaces/open", { path: p });
  const refused = await call("POST", "/api/workspaces/open", { path: p, fresh: true });
  assert.equal(refused.status, 409, "never tear a live team's sessions");
  await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
  for (const seat of ["orchestrator", "coder"]) {
    mkdirSync(dirname(sessionFile(p, seat)), { recursive: true });
    writeFileSync(sessionFile(p, seat), '{"sessionId":"old"}');
  }
  const r = await call("POST", "/api/workspaces/open", { path: p, fresh: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.fresh, true);
  assert.ok(!existsSync(sessionFile(p, "orchestrator")) && !existsSync(sessionFile(p, "coder")), "clean conversations");
  const mail = readFileSync(join(p, ".agents", "state", "inbox", "orchestrator.md"), "utf8");
  assert.match(mail, /\(engine\) \[RESUME_FRESH\].*LEFT-OFF\.md.*scout/);
  await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
});

test("Archive stops + tucks away (never running); Restore returns it Stopped; Resume clears it", async () => {
  const p = rig("arch");
  await call("POST", "/api/workspaces/open", { path: p });
  const a = await call("POST", "/api/workspaces/archive", { path: p });
  assert.equal(a.status, 200);
  assert.equal(a.body.teardown.remaining, 0);
  let row = a.body.workspaces.find((w: any) => w.path === p);
  assert.equal(row.archived, true);
  assert.equal(row.desired, "parked");
  const u = await call("POST", "/api/workspaces/unarchive", { path: p });
  row = u.body.workspaces.find((w: any) => w.path === p);
  assert.ok(!row.archived && row.desired === "parked", "restored = back in the list, still stopped");
  await call("POST", "/api/workspaces/archive", { path: p });
  await call("POST", "/api/workspaces/open", { path: p });
  row = (await call("GET", "/api/workspaces")).body.workspaces.find((w: any) => w.path === p);
  assert.ok(!row.archived && row.desired === "running", "resuming an archived workspace brings it back out");
  await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
});

test("every menu's facts: busy seats, memory held, and this computer's restart-needed", async () => {
  const p = rig("facts");
  await call("POST", "/api/workspaces/open", { path: p });
  await new Promise((r) => setTimeout(r, 600));
  const w = await call("GET", "/api/workspaces");
  const row = w.body.workspaces.find((x: any) => x.path === p);
  assert.equal(row.liveSeats, 5);
  assert.deepEqual(row.busySeats, []);
  assert.ok(row.memMB > 0, `memory held by the tagged seats is visible (${row.memMB} MB)`);
  assert.equal(typeof w.body.host.restartNeeded, "boolean");
  const fleet = await call("GET", "/api/fleet");
  const local = fleet.body.hosts.find((h: any) => h.local);
  const frow = local.workspaces.find((x: any) => x.path === p);
  assert.ok(frow.memMB > 0 && Array.isArray(frow.busySeats), "the fleet view carries the same facts");
  assert.ok(Array.isArray(local.busy));
  await call("POST", `/api/team/stop?project=${encodeURIComponent(p)}`);
});

test("the busy signal: an in-flight work record marks a headless seat mid-task", () => {
  const p = rig("busy");
  const tp = new TeamProcess(p, stub);
  tp.boot();
  try {
    assert.deepEqual(tp.busySeats(), []);
    mkdirSync(join(p, ".agents", "state", "turns", "coder"), { recursive: true });
    writeFileSync(
      join(p, ".agents", "state", "turns", "coder", "work.json"),
      JSON.stringify({ version: 1, mode: "headless", phase: "received", id: "m1", messages: ["1-a.msg"], at: new Date().toISOString() }),
    );
    assert.deepEqual(tp.busySeats(), ["coder"]);
    writeFileSync(join(p, ".agents", "state", "turns", "coder", "work.json"), '{"version":1,"mode":"headless","phase":"completed","id":"m1","messages":["1-a.msg"]}');
    assert.deepEqual(tp.busySeats(), [], "a completed record is idle");
    writeFileSync(join(p, ".agents", "state", "turns", "reviewer", "work.json").replace("reviewer", "coder"), "{not json");
    assert.deepEqual(tp.busySeats(), ["coder"], "an unreadable record counts as busy — and never throws");
  } finally {
    tp.stop();
  }
});

test("one action route for any computer: local actions run here; an unknown remote is refused plainly", async () => {
  const p = rig("route");
  const r = await call("POST", "/api/fleet/workspace", { host: "local", path: p, action: "resume" });
  assert.equal(r.status, 200);
  assert.equal(r.body.alive, 5);
  const s = await call("POST", "/api/fleet/workspace", { host: "local", path: p, action: "stop" });
  assert.equal(s.body.teardown.remaining, 0);
  const bad = await call("POST", "/api/fleet/workspace", { host: "no-such-computer", path: p, action: "stop" });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /not connected/);
  assert.equal((await call("POST", "/api/fleet/workspace", { host: "local", path: p, action: "explode" })).status, 400);
  assert.deepEqual(workspaceActionRequest("resume-fresh", "/r"), { method: "POST", route: "/api/workspaces/open", body: { path: "/r", fresh: true } });
  await new Promise((r) => gui.server.close(r));
});
