// CE-187: the GUI server's shutdown was an ASYNC handler that awaited two
// dynamic imports before stopAllTeams — so `server.close(cb)` ran its callback
// while the teams were still alive, and on a cold module cache the deferred
// stop landed after a successor server's restart-resume, killing the team it
// had just booted (workspace-lifecycle RESTART-RESUME: 0/5, every cold Linux
// run). The law: when close() reports done, the teams are ALREADY stopped.
// Deterministic on a warm cache too — the old handler yielded at its first await.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startGuiServer } from "../src/gui/server.js";
import { stopAllTeams, teamProcessFor, type SeatSpawner } from "../src/gui/teamproc.js";

const scratch = mkdtempSync(join(tmpdir(), "ce187-"));
const HOME = join(scratch, "home");
mkdirSync(join(HOME, ".crate"), { recursive: true });
const rig = join(scratch, "repos", "delta");
mkdirSync(join(rig, ".agents"), { recursive: true });
// BLEND_*=0: the runner-child path, so the stub spawner carries the boot
writeFileSync(
  join(rig, ".agents", "rig.conf"),
  "PROJECT=delta\nBLEND_ORCH=0\nBLEND_CODER=0\nBLEND_REVIEWER=0\nBLEND_DESIGNER=0\nBLEND_TESTER=0\n",
);
const stub: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

after(() => stopAllTeams());

test("server.close() reports done only AFTER every team is stopped (no deferred shutdown)", async () => {
  const gui = await startGuiServer({ home: HOME, seatSpawner: stub });
  const r = await fetch(`http://127.0.0.1:${gui.port}/api/workspaces/open`, {
    method: "POST",
    headers: { "X-Crate-Token": gui.token, "Content-Type": "application/json" },
    body: JSON.stringify({ path: rig }),
  });
  assert.equal(r.status, 200);
  assert.equal(teamProcessFor(rig, stub).status().seats.filter((s) => s.alive).length, 5, "team up before close");

  const atClose = await new Promise<number>((resolve) =>
    gui.server.close(() => resolve(teamProcessFor(rig, stub).status().seats.filter((s) => s.alive).length)),
  );
  assert.equal(atClose, 0, "when close() calls back, the shutdown has already stopped the team");
});
