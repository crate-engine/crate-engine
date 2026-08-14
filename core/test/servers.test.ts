// Backlog 13 (the Servers panel, grilled 2026-08-13). Laws under test:
// registration feeds a registry that SURVIVES close (close re-TAGS rows
// "orphaned", it never kills — the one automation moves a LABEL); discovery
// is read-only and project-scoped; system services (rig.conf DEV_URL) are
// visible but unkillable; the kill endpoint refuses anything the current
// view doesn't mark killable; confirmedKill never reports "sent" as "dead" —
// it PROVES the port freed (precheck Rider 1, ported). Real inert children
// (the teamproc.test.ts pattern), hermetic scratch dirs.
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { confirmedKill, hasLsof, nagUnregistered, parseEtime, serversView } from "../src/gui/servers.js";
import { startGuiServer, type GuiServer } from "../src/gui/server.js";
import { teamPage } from "../src/gui/teampage.js";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-servers-"));
const LSOF = hasLsof();

function makeProj(name: string, conf = 'PROJECT="rig"\n'): string {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), conf);
  return proj;
}

const children: ChildProcess[] = [];
after(() => {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGKILL");
    } catch {
      try {
        c.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  gui?.server.close();
});

/** A real inert dev-server stand-in: detached (own pgid — group-kill is
 * genuine), cwd inside the project (discovery's cwd law is genuine). */
function spawnListener(cwd: string): Promise<{ port: number; pid: number }> {
  return new Promise((resolve, reject) => {
    const c = spawn(
      "node",
      ["-e", "require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)});setInterval(()=>{},1000)"],
      { cwd, detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(c);
    let out = "";
    c.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      const m = out.match(/^(\d+)\n/);
      if (m) resolve({ port: Number(m[1]), pid: c.pid! });
    });
    c.once("error", reject);
    setTimeout(() => reject(new Error("listener never reported its port")), 5000).unref();
  });
}

const registry = (proj: string): any[] => JSON.parse(readFileSync(join(proj, ".agents", "state", "servers.json"), "utf8"));

test("parseEtime handles ss, mm:ss, hh:mm:ss, and dd-hh:mm:ss", () => {
  assert.equal(parseEtime("00:42"), 42);
  assert.equal(parseEtime("05:00"), 300);
  assert.equal(parseEtime("01:00:00"), 3600);
  assert.equal(parseEtime("2-01:00:30"), 176430);
  assert.equal(parseEtime("garbage"), null);
});

test("a REGISTERED server shows with pid, memory, and age — the proven association", { skip: !LSOF }, async () => {
  const proj = makeProj("reg");
  const { port, pid } = await spawnListener(proj);
  writeFileSync(
    join(proj, ".agents", "state", "servers.json"),
    JSON.stringify([{ url: `http://127.0.0.1:${port}`, port, label: "docket dev", from: "designer", task: "feature/x", at: "2026-08-13T10:00:00", status: "live" }]),
  );
  const v = serversView(proj);
  const row = v.servers.find((s) => s.port === port);
  assert.ok(row, "the registered server appears");
  assert.equal(row!.kind, "registered");
  assert.equal(row!.pid, pid, "pid comes from the LIVE listener, not the record");
  assert.equal(row!.task, "feature/x");
  assert.equal(row!.killable, true);
  assert.ok(row!.rssMb !== null && row!.rssMb > 0, "memory is real (RSS)");
  assert.ok(row!.ageSecs !== null && row!.ageSecs >= 0, "age is real (etime)");
  assert.equal(v.orphans, 0, "a live row is not an orphan");
});

test("DISCOVERY is read-only and project-scoped: an unregistered listener born in the project shows as discovered", { skip: !LSOF }, async () => {
  const proj = makeProj("disc");
  const { port, pid } = await spawnListener(proj);
  const v = serversView(proj);
  const row = v.servers.find((s) => s.port === port);
  assert.ok(row, "the project's own listener is discovered");
  assert.equal(row!.kind, "discovered");
  assert.equal(row!.pid, pid);
  assert.equal(row!.killable, true);
  // …and a DIFFERENT project does not see it (cwd scoping, not port scanning)
  const other = makeProj("disc-other");
  assert.ok(!serversView(other).servers.some((s) => s.port === port), "another project's view must not claim it");
});

test("STANDING INFRA (rig.conf DEV_URL port) is visible but UNTOUCHABLE — kill disabled", { skip: !LSOF }, async () => {
  const proj = makeProj("sys");
  const { port } = await spawnListener(proj);
  writeFileSync(join(proj, ".agents", "rig.conf"), `PROJECT="rig"\nDEV_URL="http://127.0.0.1:${port}"\n`);
  const v = serversView(proj);
  const row = v.servers.find((s) => s.port === port);
  assert.ok(row, "the system service is VISIBLE");
  assert.equal(row!.kind, "system-service");
  assert.equal(row!.killable, false, "…and untouchable");
});

test("a registry row whose port went quiet PRUNES on read — a dead server needs no row and no kill", { skip: !LSOF }, async () => {
  const proj = makeProj("prune");
  // find a port that is genuinely free, then register it as if a server died there
  const { port, pid } = await spawnListener(proj);
  process.kill(-pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  const live = await spawnListener(proj);
  writeFileSync(
    join(proj, ".agents", "state", "servers.json"),
    JSON.stringify([
      { url: `http://127.0.0.1:${port}`, port, label: "dead", from: "designer", task: "t", at: "2026-08-13T10:00:00", status: "orphaned" },
      { url: `http://127.0.0.1:${live.port}`, port: live.port, label: "alive", from: "designer", task: "t", at: "2026-08-13T10:00:00", status: "live" },
    ]),
  );
  const v = serversView(proj);
  assert.ok(!v.servers.some((s) => s.port === port), "the quiet port has no row");
  assert.ok(v.servers.some((s) => s.port === live.port), "the live one stays");
  assert.deepEqual(registry(proj).map((r: any) => r.port), [live.port], "the file pruned too");
});

test("confirmedKill: SIGTERM the group, PROVE the port freed, stamp honestly", { skip: !LSOF }, async () => {
  const proj = makeProj("kill");
  const { port, pid } = await spawnListener(proj);
  const r = await confirmedKill(port, pid);
  assert.equal(r.ok, true);
  assert.equal(r.freed, true, "freed is PROVEN by binding, not assumed from the signal");
  assert.equal(r.escalated, false, "an inert child dies on SIGTERM — no escalation");
  assert.ok(!serversView(proj).servers.some((s) => s.port === port), "the panel shows it gone");
});

test("confirmedKill REFUSES a stale row — the pid must hold the port right now (pid-reuse safety)", { skip: !LSOF }, async () => {
  const proj = makeProj("stale");
  const { port } = await spawnListener(proj);
  const r = await confirmedKill(port, 99999999);
  assert.equal(r.ok, false);
  assert.match(r.note, /stale/, "the refusal names staleness");
  assert.ok(serversView(proj).servers.some((s) => s.port === port), "nothing died");
});

// ── the endpoints (the gui.test.ts call convention) ──
let gui: GuiServer;
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`http://127.0.0.1:${gui.port}${path}`, {
    method,
    headers: { "X-Crate-Token": token ?? gui.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

test("GET /api/servers is token-gated and honest with no project", async () => {
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  gui = await startGuiServer({ home });
  const noTok = await fetch(`http://127.0.0.1:${gui.port}/api/servers`);
  assert.equal(noTok.status, 403, "no token → 403, like everything else");
  const r = await call("GET", "/api/servers");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.servers, []);
});

test("POST /api/servers/kill refuses a system service (409) and a stale row (409) — the payload cannot reach arbitrary processes", { skip: !LSOF }, async () => {
  const proj = makeProj("api-sys");
  const { port, pid } = await spawnListener(proj);
  writeFileSync(join(proj, ".agents", "rig.conf"), `PROJECT="rig"\nDEV_URL="http://127.0.0.1:${port}"\n`);
  gui.state.project = proj;
  try {
    const sys = await call("POST", "/api/servers/kill", { port, pid });
    assert.equal(sys.status, 409);
    assert.match(sys.body.error, /system service/);
    const stale = await call("POST", "/api/servers/kill", { port: 1, pid: 1 });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /stale/);
  } finally {
    gui.state.project = undefined as any;
  }
});

test("the kill endpoint kills a killable row end-to-end and reports the PROVEN result", { skip: !LSOF }, async () => {
  const proj = makeProj("api-kill");
  const { port, pid } = await spawnListener(proj);
  gui.state.project = proj;
  try {
    const r = await call("POST", "/api/servers/kill", { port, pid });
    assert.equal(r.status, 200);
    assert.equal(r.body.freed, true);
  } finally {
    gui.state.project = undefined as any;
  }
});

// ── the python side: registration feeds the registry; close re-tags, never kills ──

function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  writeFileSync(
    join(rig, ".agents", "config", "state-machine.yaml"),
    [
      "initial: idle",
      "always_legal: checkpoint, gate_pass, gate_release",
      "transitions:",
      "  start_impl: idle -> implementing",
      "  code_ready: implementing -> code_ready",
      "  approved: code_ready -> approved",
      "  deployed: approved -> deployed",
      "  close: deployed -> idle",
    ].join("\n"),
  );
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: rig });
  writeFileSync(join(rig, "README.md"), "rig\n");
  const gitEnv = ["-c", "user.email=test@test", "-c", "user.name=test"];
  execFileSync("git", [...gitEnv, "add", "-A"], { cwd: rig });
  execFileSync("git", [...gitEnv, "commit", "--quiet", "-m", "init"], { cwd: rig });
  return rig;
}

function ctl(rig: string, ...args: string[]): { ok: boolean; out: string } {
  const env = { ...process.env };
  delete env.CRATE_SEAT;
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8", env }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

test("agentctl preview UPSERTS the server registry (task = the branch), and preview clear leaves it alone", () => {
  const rig = makeRig("py-reg");
  const r = ctl(rig, "preview", "http://127.0.0.1:4242", "--route", "/garage", "--label", "Garage", "--from", "designer");
  assert.equal(r.ok, true, r.out);
  let reg = registry(rig);
  assert.equal(reg.length, 1);
  assert.equal(reg[0].port, 4242);
  assert.equal(reg[0].label, "Garage");
  assert.equal(reg[0].task, "main", "task identity = the git branch (D1)");
  assert.equal(reg[0].status, "live");
  // re-registration UPSERTS by url (the row is the server, not the event)
  ctl(rig, "preview", "http://127.0.0.1:4242", "--label", "Garage v2", "--from", "designer");
  reg = registry(rig);
  assert.equal(reg.length, 1, "same url → one row");
  assert.equal(reg[0].label, "Garage v2");
  // clear deletes preview.json (the chip) but NOT the registry (the panel)
  ctl(rig, "preview", "clear");
  assert.ok(!existsSync(join(rig, ".agents", "state", "preview.json")), "preview.json cleared");
  assert.equal(registry(rig).length, 1, "servers.json survives clear");
});

test("CLOSE re-tags the loop's servers 'orphaned' — a label moved, nothing killed; preview.json still dies with the loop", () => {
  const rig = makeRig("py-close");
  ctl(rig, "preview", "http://127.0.0.1:5151", "--from", "designer");
  for (const ev of ["start_impl", "code_ready", "approved"]) {
    const r = ctl(rig, "emit", ev, "--actor", "orchestrator");
    assert.equal(r.ok, true, r.out);
  }
  // the REAL merge gate holds deployed until the operator's release — honor it
  const rel = ctl(rig, "emit", "gate_release", "--actor", "operator", 'phrase=merge go');
  assert.equal(rel.ok, true, rel.out);
  const dep = ctl(rig, "emit", "deployed", "--actor", "orchestrator");
  assert.equal(dep.ok, true, dep.out);
  const close = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.equal(close.ok, true, close.out);
  const reg = registry(rig);
  assert.equal(reg.length, 1, "the registry SURVIVES close — nothing deleted, nothing killed");
  assert.equal(reg[0].status, "orphaned");
  assert.ok(reg[0].orphanedAt, "the re-tag is stamped");
  assert.ok(!existsSync(join(rig, ".agents", "state", "preview.json")), "preview hygiene unchanged");
});

// ── the cockpit page (structural assertions, the gate-bar precedent) ──

test("the masthead grows a Servers chip with its overlay, chevron sync, and 10s poll — off the 2s heartbeat", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(html.includes('id="svbtn"'), "the chip is in the masthead");
  assert.ok(html.includes('id="svoverlay"'), "the overlay hangs off it");
  assert.ok(html.includes('["svbtn","svoverlay"]'), "the chevron spins with the panel");
  assert.ok(/setInterval\(refreshServers,10000\)/.test(html), "servers poll on their OWN 10s cadence (lsof is too heavy for the 2s poll)");
  assert.ok(html.includes("function renderServers"), "the panel renders");
  assert.ok(html.includes("orphaned — safe to kill"), "the orphan label is the grill's exact copy");
  assert.ok(html.includes("system service"), "standing infra is tagged");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  for (const s of scripts) new Function(s); // the whole page script still parses
});

// ── ENGINE ASSIST (design-previews entry, thread 2): the belt behind the
// registration law — ONE dedup'd nudge for an unregistered mid-task listener ──

test("an unregistered mid-task listener earns ONE nudge to the orchestrator — dedup'd forever after", { skip: !LSOF }, async () => {
  const rig = makeRig("py-nag");
  mkdirSync(join(rig, ".agents", "bin"), { recursive: true });
  copyFileSync(AGENTCTL, join(rig, ".agents", "bin", "agentctl.py"));
  writeFileSync(
    join(rig, ".agents", "state", "events.log"),
    "[2026-08-13T11:00:00-05:00] START_IMPL actor=orchestrator state=implementing\n",
  );
  const { port } = await spawnListener(rig);
  const nagged = nagUnregistered(rig, serversView(rig), 0);
  assert.deepEqual(nagged, [port], "the discovered listener gets its nudge");
  const newDir = join(rig, ".agents", "state", "inbox", "orchestrator", "new");
  const mails = readdirSync(newDir);
  assert.ok(mails.length >= 1, "the nudge is a REAL delivery (maildir)");
  const body = readFileSync(join(newDir, mails[0]!), "utf8");
  assert.match(body, /ENGINE ASSIST/, "named as the engine's assist, not a seat's voice");
  assert.match(body, new RegExp(`:${port}`), "names the port");
  assert.match(body, /agentctl\.py preview/, "carries the exact registration command");
  // dedup: the next poll nags NOTHING (marker persisted)
  assert.deepEqual(nagUnregistered(rig, serversView(rig), 0), [], "one nudge per loop+port, ever");
  assert.equal(readdirSync(newDir).length, mails.length, "no duplicate mail");
});

test("the nag holds its tongue: idle loop → silent; registered listener → silent", { skip: !LSOF }, async () => {
  // idle rig: a live listener but NO loop in flight
  const idle = makeRig("py-nag-idle");
  mkdirSync(join(idle, ".agents", "bin"), { recursive: true });
  copyFileSync(AGENTCTL, join(idle, ".agents", "bin", "agentctl.py"));
  await spawnListener(idle);
  assert.deepEqual(nagUnregistered(idle, serversView(idle), 0), [], "no loop in flight → no nag");
  // active rig, but the listener is REGISTERED — the law was followed
  const reg = makeRig("py-nag-reg");
  mkdirSync(join(reg, ".agents", "bin"), { recursive: true });
  copyFileSync(AGENTCTL, join(reg, ".agents", "bin", "agentctl.py"));
  writeFileSync(
    join(reg, ".agents", "state", "events.log"),
    "[2026-08-13T11:00:00-05:00] START_IMPL actor=orchestrator state=implementing\n",
  );
  const l = await spawnListener(reg);
  writeFileSync(
    join(reg, ".agents", "state", "servers.json"),
    JSON.stringify([{ url: `http://127.0.0.1:${l.port}`, port: l.port, label: "x", from: "designer", task: "main", at: "2026-08-13T11:01:00", status: "live" }]),
  );
  assert.deepEqual(nagUnregistered(reg, serversView(reg), 0), [], "a registered listener is the law FOLLOWED — silence");
});

test("the engine never watches ITSELF: its own process's listeners are invisible to the panel and the nag", { skip: !LSOF }, async () => {
  const proj = makeProj("self");
  // an IN-PROCESS listener (the engine's own posture: cockpit API + preview
  // proxy live in the GUI server's pid) + a registry row claiming its port
  const { createServer } = await import("node:http");
  const srv = await new Promise<any>((res) => {
    const s = createServer((_q, r) => r.end("ok"));
    s.listen(0, "127.0.0.1", () => res(s));
  });
  const port = srv.address().port;
  try {
    writeFileSync(
      join(proj, ".agents", "state", "servers.json"),
      JSON.stringify([{ url: `http://127.0.0.1:${port}`, port, label: "self", from: "engine", task: "t", at: "2026-08-14T10:00:00", status: "live" }]),
    );
    const v = serversView(proj);
    assert.ok(!v.servers.some((s) => s.port === port), "our own pid's listener never shows");
    assert.deepEqual(nagUnregistered(proj, v, 0), [], "…and can never be nagged about");
  } finally {
    srv.close();
  }
});
