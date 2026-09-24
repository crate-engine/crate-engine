// CE-190 — the engine-owned, ON-DEMAND Design Studio preview (Adam, 2026-09-24:
// "I only want them open when the Design Studio windows are open … avoid dev
// server and background bloat that I can't see"). Real static-serve children on
// real ports; a fake clock drives the viewer TTL and the 2-minute grace.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync as require_symlink, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { GRACE_MS, StudioServers, VIEWER_TTL_MS, demandPath, studioPlan } from "../src/gui/studioserve.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ce190-")));
const live: StudioServers[] = [];
after(() => live.forEach((s) => s.stopAll()));

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

function staticSite(name: string, port: number): string {
  const p = join(scratch, name);
  mkdirSync(join(p, ".agents", "state"), { recursive: true });
  writeFileSync(join(p, "index.html"), "<h1>hero</h1>");
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT=${name}\nDEV_URL="http://127.0.0.1:${port}"\n`);
  return p;
}

const get = async (port: number): Promise<number> => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) })).status;
  } catch {
    return 0;
  }
};
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

test("only a STATIC site is engine-served; an app project keeps its own dev server", async () => {
  const port = await freePort();
  const site = staticSite("site-plan", port);
  const plan = studioPlan(site, BIN);
  assert.ok(plan, "a plain-HTML site gets an engine preview");
  assert.equal(plan!.port, port, "on the rig's own dev port");
  const app = join(scratch, "app-plan");
  mkdirSync(join(app, ".agents"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
  writeFileSync(join(app, ".agents", "rig.conf"), "PROJECT=app\n");
  assert.equal(studioPlan(app, BIN), undefined, "an app project previews on its dev server — not ours to manage");
});

test("a Studio window opens it; closing the window stops it after the grace period — never before", async () => {
  const port = await freePort();
  const site = staticSite("site-life", port);
  let t = 1_000_000;
  const s = new StudioServers(BIN, () => undefined, () => t);
  live.push(s);
  const running = new Set([site]);
  await s.tick(running);
  assert.equal(await get(port), 0, "nothing runs until someone uses it");

  assert.equal(s.touchViewer(site, "desktop-a"), true);
  await s.tick(running);
  await settle();
  assert.equal(await get(port), 200, "a Studio window checking in brings it up");
  assert.equal(s.status(site)!.windows, 1);

  t += VIEWER_TTL_MS + 1; // the window closed — it stopped checking in
  await s.tick(running);
  assert.equal(await get(port), 200, "the grace period: closing a window does not kill it at once");
  assert.ok((s.status(site)!.stopsInMs ?? 0) > 0, "and the panel can say when it will stop");

  t += GRACE_MS + 1;
  await s.tick(running);
  await settle();
  assert.equal(await get(port), 0, "nobody used it for 2 minutes — it is gone");
  assert.equal(s.status(site)!.running, false);
});

test("the designer's lease (agentctl studio-serve) runs it with no window open; a stopped workspace never serves", async () => {
  const port = await freePort();
  const site = staticSite("site-lease", port);
  let t = Date.now();
  const s = new StudioServers(BIN, () => undefined, () => t);
  live.push(s);
  writeFileSync(demandPath(site), JSON.stringify({ until: new Date(t + 20 * 60_000).toISOString() }));
  await s.tick(new Set()); // the workspace is NOT running
  await settle();
  assert.equal(await get(port), 0, "a stopped workspace never serves — stopped means zero");
  await s.tick(new Set([site]));
  await settle();
  assert.equal(await get(port), 200, "the designer's lease brings it up without any window");
  assert.equal(s.status(site)!.designer, true);
  t += 20 * 60_000 + GRACE_MS + 2;
  await s.tick(new Set([site]));
  await settle();
  assert.equal(await get(port), 0, "the lease lapsed and nobody used it — gone");
});

test("a port someone else holds is never fought over — it is reported, not taken", async () => {
  const port = await freePort();
  const site = staticSite("site-busy", port);
  const squatter: Server = createServer().listen(port, "127.0.0.1");
  await settle(200);
  const s = new StudioServers(BIN);
  live.push(s);
  s.touchViewer(site, "w");
  await s.tick(new Set([site]));
  assert.match(s.status(site)!.blocked ?? "", /already in use/);
  squatter.close();
});

test("agentctl studio-serve: writes the designer's lease; an app project is pointed at its dev server instead", () => {
  const port = 1; // nothing listens — the command reports honestly without waiting on a real engine
  const site = staticSite("site-cli", port);
  require_symlink(join(BIN, "..", "config"), join(site, ".agents", "config")); // a real rig links the engine config
  const out = execFileSync("python3", [join(BIN, "agentctl.py"), "studio-serve", "5"], {
    cwd: site, encoding: "utf8", env: { ...process.env, CRATE_SEAT: "" }, timeout: 60_000,
  });
  assert.match(out, /Do NOT start your own server/);
  const lease = JSON.parse(readFileSync(demandPath(site), "utf8"));
  assert.ok(Date.parse(lease.until) > Date.now() + 4 * 60_000, "a 5-minute lease");
});

test("end to end through the real server: a Studio window checking in brings the preview up, live, and visible in Dev Servers", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const { registerWorkspace, setWorkspaceDesired } = await import("../src/gui/workspaces.js");
  const home = join(scratch, "home-e2e");
  mkdirSync(join(home, ".crate"), { recursive: true });
  const port = await freePort();
  const site = staticSite("site-e2e", port);
  writeFileSync(join(site, ".agents", "state", "preview.json"),
    JSON.stringify([{ url: `http://127.0.0.1:${port}`, route: "/", label: "hero", from: "designer", at: new Date().toISOString() }]));
  registerWorkspace(home, site);
  setWorkspaceDesired(home, site, "running");
  const gui = await startGuiServer({ home, seatSpawner: () => { throw new Error("no seats in this test"); } });
  const call = async (path: string) =>
    (await fetch(`http://127.0.0.1:${gui.port}${path}${path.includes("?") ? "&" : "?"}token=${gui.token}&project=${encodeURIComponent(site)}`)).json() as Promise<any>;
  try {
    assert.equal(await get(port), 0, "no window, no designer — nothing runs");
    const first = await call("/api/studio/state?viewer=desktop-t1");
    assert.equal(first.engineServed.windows, 1, "the window's check-in is counted");
    let live = first;
    for (let i = 0; i < 10 && live.mode !== "live"; i++) {
      assert.notEqual(live.reason, "the preview server went down", "never 'went down' for a preview the engine is bringing up");
      await settle(300);
      live = await call("/api/studio/state?viewer=desktop-t1");
    }
    assert.equal(live.mode, "live", "the Studio renders the design");
    assert.equal(await get(port), 200);
    const servers = await call("/api/servers");
    assert.equal(servers.studio.running, true, "Dev Servers shows the engine's preview");
    assert.ok(!servers.servers.some((r: any) => r.port === port), "and never as a stray, nag-worthy listener");
  } finally {
    await new Promise((r) => gui.server.close(r));
    await settle();
    assert.equal(await get(port), 0, "the engine's previews never outlive it");
  }
});

test("the designer is told never to start its own preview server; the Studio window checks in; the panel shows who is using it", () => {
  const read = (rel: string) => readFileSync(join(BIN, "..", rel), "utf8");
  const designer = read("config/designer.md");
  assert.match(designer, /Never start your own preview server/);
  assert.match(designer, /agentctl\.py studio-serve/);
  assert.match(read("config/procedures/design-lock-preview.md"), /studio-serve/);
  assert.match(read("core/src/gui/studiopage.ts"), /&viewer="\+encodeURIComponent\(VIEWER\)/, "every Studio poll is a check-in");
  const page = read("core/src/gui/teampage.ts");
  assert.match(page, /SERVERS\.studio/);
  assert.match(page, /engine-managed/);
  assert.match(page, /stops in/);
});
