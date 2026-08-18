// CE-142 — removing the workspace you are LOOKING AT must repoint the server.
//
// Found by the 2026-08-18 self-driven QA sweep while tearing the scratch rig
// down: after POST /api/workspaces/remove of the active workspace, the registry
// was empty but the server still answered `active: <the removed path>`. Every
// route that defaults to state.project (team status, preview, chat, loop) then
// worked a path that is no longer registered — and a chat send would re-create
// a maildir underneath it. It self-healed only on the next engine restart.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startGuiServer, type GuiServer } from "../src/gui/server.js";
import { stopAllTeams, type SeatSpawner } from "../src/gui/teamproc.js";

const scratch = mkdtempSync(join(tmpdir(), "ce142-"));
const HOME = join(scratch, "home");
mkdirSync(join(HOME, ".crate"), { recursive: true });

/** Never spawn anything real — this test is about the pointer, not the team. */
const stub: SeatSpawner = () => ({ pid: 1, kill: () => true, on: () => {}, exitCode: 0, signalCode: null, killed: false }) as never;

function mkRig(name: string): string {
  const p = join(scratch, "repos", name);
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(
    join(p, ".agents", "rig.conf"),
    `PROJECT=${name}\nBLEND_ORCH=0\nBLEND_CODER=0\nBLEND_REVIEWER=0\nBLEND_DESIGNER=0\nBLEND_TESTER=0\n`,
  );
  return p;
}

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

test("CE-142: removing the ACTIVE workspace repoints the server at what's left", async () => {
  gui = await startGuiServer({ home: HOME, seatSpawner: stub });
  await call("POST", "/api/workspaces", { path: A });
  await call("POST", "/api/workspaces", { path: B });
  // focus beta, then drop it — the classic "remove the one I'm looking at"
  await call("POST", "/api/workspaces/open", { path: B });
  const before = await call("GET", "/api/workspaces");
  assert.equal(before.body.active, B, "beta is the active view");

  const rm = await call("POST", "/api/workspaces/remove", { path: B });
  assert.equal(rm.status, 200);
  assert.deepEqual(
    rm.body.workspaces.map((w: any) => w.path),
    [A],
    "beta is off the rail",
  );

  const after_ = await call("GET", "/api/workspaces");
  assert.notEqual(after_.body.active, B, "the server must NOT still point at the removed workspace");
  assert.equal(after_.body.active, A, "it repoints at the remaining workspace");
});

test("CE-142: removing a NON-active workspace leaves the view where it was", async () => {
  await call("POST", "/api/workspaces", { path: B });
  await call("POST", "/api/workspaces/open", { path: A });
  await call("POST", "/api/workspaces/remove", { path: B });
  const v = await call("GET", "/api/workspaces");
  assert.equal(v.body.active, A, "an unrelated removal never moves the user's view");
});

test("CE-142: removing the LAST workspace leaves an honest empty state, not a ghost path", async () => {
  await call("POST", "/api/workspaces/open", { path: A });
  await call("POST", "/api/workspaces/remove", { path: A });
  const v = await call("GET", "/api/workspaces");
  assert.deepEqual(v.body.workspaces, [], "nothing left on the rail");
  assert.ok(
    v.body.active === null || v.body.active === undefined,
    `active must be empty, got ${JSON.stringify(v.body.active)} — the page renders the attach card from this`,
  );
});
