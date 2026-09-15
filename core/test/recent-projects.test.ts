import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startGuiServer } from "../src/gui/server.js";
import { listWorkspaces, registerWorkspace } from "../src/gui/workspaces.js";

test("returning to a recent project changes focus without starting a parked team; missing stays remembered", async () => {
  const home = mkdtempSync(join(tmpdir(), "crate-recents-"));
  const project = join(home, "project");
  mkdirSync(join(home, ".crate")); mkdirSync(join(project, ".agents"), { recursive: true });
  writeFileSync(join(project, ".agents/rig.conf"), "PROJECT=fixture\n");
  registerWorkspace(home, project);
  let launches = 0;
  const gui = await startGuiServer({ home, seatSpawner: () => { launches++; throw new Error("Viewing must never launch a seat"); } });
  const view = () => fetch(`http://127.0.0.1:${gui.port}/api/workspaces/view`, {
    method: "POST", headers: { "X-Crate-Token": gui.token, "Content-Type": "application/json" }, body: JSON.stringify({ path: project }),
  });
  try {
    assert.equal((await view()).status, 200);
    const before = listWorkspaces(home)[0]!;
    assert.equal(before.desired, "parked"); assert.ok(before.focusedAt); assert.equal(launches, 0);
    rmSync(join(project, ".agents"), { recursive: true });
    assert.equal((await view()).status, 404);
    assert.equal(listWorkspaces(home)[0]!.focusedAt, before.focusedAt);
    assert.equal(listWorkspaces(home).length, 1);
    assert.equal(launches, 0);
  } finally { gui.server.close(); rmSync(home, { recursive: true, force: true }); }
});
