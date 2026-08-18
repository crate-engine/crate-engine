// Workspace lifecycle S1, server-level (PDR dev/pdr/workspace-lifecycle.md):
// ONE engine supervises N Running workspaces at once — cmux's model in
// Crate's physics. Driven hermetically through the real GUI server with the
// injected stub spawner (a boot here must never spawn real runners), rigs
// flagged BLEND_*=0 so every seat takes the runner-child path onto the stub.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startGuiServer, type GuiServer } from "../src/gui/server.js";
import {
  idleParkMinutes,
  idleParkTargets,
  stopAllTeams,
  TeamProcess,
  type SeatSpawner,
  type TeamProcStatus,
} from "../src/gui/teamproc.js";
import { teamPage } from "../src/gui/teampage.js";
import { listWorkspaces } from "../src/gui/workspaces.js";

const scratch = mkdtempSync(join(tmpdir(), "wl-server-"));
const HOME = join(scratch, "home");
mkdirSync(join(HOME, ".crate"), { recursive: true });

function mkRig(name: string): string {
  const p = join(scratch, "repos", name);
  mkdirSync(join(p, ".agents"), { recursive: true });
  // BLEND_*=0: force the runner-child path so the stub spawner carries boots
  writeFileSync(
    join(p, ".agents", "rig.conf"),
    `PROJECT=${name}\nBLEND_ORCH=0\nBLEND_CODER=0\nBLEND_REVIEWER=0\nBLEND_DESIGNER=0\nBLEND_TESTER=0\n`,
  );
  return p;
}

const stub: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

let gui: GuiServer;
const A = mkRig("alpha");
const B = mkRig("beta");

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${gui.port}${path}`, {
    method,
    headers: { "X-Crate-Token": gui.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

after(() => {
  stopAllTeams();
  gui?.server.close();
  rmSync(scratch, { recursive: true, force: true });
});

test("co-tenancy: TWO workspaces run in ONE engine — opening the second never touches the first", async () => {
  gui = await startGuiServer({ home: HOME, seatSpawner: stub });
  const openA = await call("POST", "/api/workspaces/open", { path: A });
  assert.equal(openA.status, 200);
  assert.equal(openA.body.alive, 5, "alpha's five seats live");
  const openB = await call("POST", "/api/workspaces/open", { path: B });
  assert.equal(openB.status, 200);
  assert.equal(openB.body.alive, 5, "beta's five seats live");
  // THE law: alpha is untouched by beta's open
  const stA = await call("GET", `/api/team/status?project=${encodeURIComponent(A)}`);
  assert.equal(stA.body.seats.filter((s: any) => s.alive).length, 5, "alpha survived beta's open — the eviction is dead");
  const both = listWorkspaces(HOME).filter((w) => w.desired === "running");
  assert.equal(both.length, 2, "both are Running on the record");
});

test("open is idempotent — a second open of a live workspace leaves its seats alone", async () => {
  const stBefore = await call("GET", `/api/team/status?project=${encodeURIComponent(A)}`);
  const pidsBefore = stBefore.body.seats.map((s: any) => s.pid);
  await call("POST", "/api/workspaces/open", { path: A });
  const stAfter = await call("GET", `/api/team/status?project=${encodeURIComponent(A)}`);
  assert.deepEqual(stAfter.body.seats.map((s: any) => s.pid), pidsBefore, "live seats keep their pids");
});

test("a scoped stop parks exactly one workspace — record AND processes; the neighbour keeps running", async () => {
  const stop = await call("POST", `/api/team/stop?project=${encodeURIComponent(A)}`);
  assert.equal(stop.status, 200);
  await new Promise((r) => setTimeout(r, 300)); // SIGTERM lands
  const stA = await call("GET", `/api/team/status?project=${encodeURIComponent(A)}`);
  assert.equal(stA.body.seats.filter((s: any) => s.alive).length, 0, "alpha parked");
  assert.equal(stA.body.desired, "parked", "the status route carries the record");
  const stB = await call("GET", `/api/team/status?project=${encodeURIComponent(B)}`);
  assert.equal(stB.body.seats.filter((s: any) => s.alive).length, 5, "beta untouched");
  const rec = Object.fromEntries(listWorkspaces(HOME).map((w) => [w.path, w.desired]));
  assert.equal(rec[A], "parked");
  assert.equal(rec[B], "running");
});

test("the rail's rows carry the record + LIVE seat count (peeked, never instantiated)", async () => {
  const ws = await call("GET", "/api/workspaces");
  const rows = Object.fromEntries(ws.body.workspaces.map((w: any) => [w.path, w]));
  assert.equal(rows[A].desired, "parked");
  assert.equal(rows[A].liveSeats, 0);
  assert.equal(rows[B].desired, "running");
  assert.equal(rows[B].liveSeats, 5);
});

test("boot marks the record running again (the record follows intent, not accident)", async () => {
  const boot = await call("POST", `/api/team/boot?project=${encodeURIComponent(A)}`);
  assert.equal(boot.status, 200);
  assert.equal(listWorkspaces(HOME).find((w) => w.path === A)?.desired, "running");
  // park A again so the resume test below proves BOTH directions of the record
  await call("POST", `/api/team/stop?project=${encodeURIComponent(A)}`);
});

test("RESTART-RESUME: a fresh server boots exactly what the record says — running resumes, parked stays parked", async () => {
  // simulate the engine dying: teams stop, records survive (bare shutdown never rewrites them)
  stopAllTeams();
  gui.server.close();
  gui = await startGuiServer({ home: HOME, seatSpawner: stub });
  const stB = await call("GET", `/api/team/status?project=${encodeURIComponent(B)}`);
  assert.equal(stB.body.seats.filter((s: any) => s.alive).length, 5, "desired-running beta came back by itself");
  const stA = await call("GET", `/api/team/status?project=${encodeURIComponent(A)}`);
  assert.equal(stA.body.seats.filter((s: any) => s.alive).length, 0, "parked alpha was NOT booted — never more than the record");
});

// ── S3: the glass + the idle knob ───────────────────────────────────────────

test("parkSeat parks ONE seat visibly — stamped first, then an invitation (no corpse record), team stays booted", async () => {
  const p = mkRig("gamma");
  const tp = new TeamProcess(p, stub);
  try {
    tp.boot();
    mkdirSync(join(p, ".agents", "state", "turns", "coder"), { recursive: true });
    tp.parkSeat("coder", "idle-parked | test stamp");
    const st = tp.status();
    assert.equal(st.seats.filter((s) => s.alive).length, 4, "exactly one seat parked");
    const coder = st.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.alive, false);
    assert.equal(coder.startedAt, null, "parked reads as unstaffed (invitation), never as died (distress)");
    assert.equal(st.booted, true, "the workspace stays Running — the orchestrator holds it");
    const log = readFileSync(join(p, ".agents", "state", "turns", "coder", "turns.log"), "utf8");
    assert.match(log, /idle-parked/, "the stamp says why, on the record");
  } finally {
    tp.stop();
  }
});

test("the idle knob is OFF by default and NEVER parks the orchestrator; a just-booted team gets its grace", () => {
  const now = 10_000_000;
  const min30 = 30 * 60_000;
  const st: TeamProcStatus = {
    booted: true,
    seats: [
      { seat: "orchestrator", alive: true, pid: 1, startedAt: now - 2 * min30 },
      { seat: "coder", alive: true, pid: 2, startedAt: now - 2 * min30 },
      { seat: "reviewer", alive: true, pid: 3, startedAt: now - 1000 }, // just relaunched — grace
      { seat: "designer", alive: false, pid: null, startedAt: null },
      { seat: "tester", alive: true, pid: 5, startedAt: now - 2 * min30 },
    ],
  };
  assert.equal(idleParkMinutes({}), undefined, "no IDLE_PARK_MIN = the knob is OFF (cmux never reaps your terminals)");
  assert.equal(idleParkMinutes({ IDLE_PARK_MIN: "0" }), undefined, "zero is off, not instant");
  assert.equal(idleParkMinutes({ IDLE_PARK_MIN: "30" }), 30);
  assert.deepEqual(idleParkTargets(st, undefined, now - 2 * min30, now), [], "knob off → nothing parks, ever");
  assert.deepEqual(idleParkTargets(st, 30, now - 1000, now), [], "recent activity → nothing parks");
  assert.deepEqual(idleParkTargets(st, 30, now - 2 * min30, now), ["coder", "tester"], "quiet + up long enough → workers only; the orchestrator NEVER");
  assert.deepEqual(idleParkTargets(st, 30, null, now), ["coder", "tester"], "a team that never turned still idles by uptime");
});

test("the rail's glass reads the record: live seat counts, parked, resuming", () => {
  const html = teamPage({ project: "demo", seats: [] });
  const fn = html.slice(html.indexOf("function wsStatus"), html.indexOf("function renderRail"));
  assert.match(fn, /w\.liveSeats>0/, "Running shows its live seat count");
  assert.match(fn, /"resuming"/, "record-running with no seats yet reads as resuming, not dead");
  assert.match(fn, /"parked"/, "and a seat-less workspace is PARKED — calm, never a crash costume");
});

test("per-workspace preview proxies: each workspace points its OWN target on its OWN port", async () => {
  const pa = await call("POST", `/api/preview/point?project=${encodeURIComponent(A)}`, { url: "http://127.0.0.1:59991" });
  const pb = await call("POST", `/api/preview/point?project=${encodeURIComponent(B)}`, { url: "http://127.0.0.1:59992" });
  assert.equal(pa.status, 200);
  assert.equal(pb.status, 200);
  assert.notEqual(pa.body.proxyPort, pb.body.proxyPort, "two workspaces, two listeners — the singleton is dead");
  const ga = await call("GET", `/api/preview?project=${encodeURIComponent(A)}`);
  const gb = await call("GET", `/api/preview?project=${encodeURIComponent(B)}`);
  assert.equal(ga.body.target, "http://127.0.0.1:59991");
  assert.equal(gb.body.target, "http://127.0.0.1:59992");
  assert.equal(ga.body.proxyPort, pa.body.proxyPort);
  assert.equal(gb.body.proxyPort, pb.body.proxyPort);
});
