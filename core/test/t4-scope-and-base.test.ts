// PHASE-7 T4 — the coder scope ack (doctrine pins) + the rider fix from the
// T3 harvest: QA tools REFUSE to guess a base (rig.conf DEV_URL is the
// default; nothing serving there = loud failure, never a silent sweep of
// whatever app happens to own a hardcoded port).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { devUrlFromRigConf, resolveBase } from "../src/tools/qa-sweep.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(ROOT, "core");
const scratch = mkdtempSync(join(tmpdir(), "crate2-t4-"));

function mkRig(devUrl?: string): string {
  const rig = join(scratch, `rig-${devUrl ? devUrl.replace(/[^0-9]/g, "") : "none"}`);
  mkdirSync(join(rig, ".agents"), { recursive: true });
  if (devUrl) writeFileSync(join(rig, ".agents", "rig.conf"), `PROJECT="rig"\nDEV_URL="${devUrl}"\n`);
  return rig;
}

let server: Server;
const port = 5999;
after(() => server?.close());

test("resolveBase: rig.conf DEV_URL is the default base when something is serving there", async () => {
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(port, r));
  const rig = mkRig(`http://localhost:${port}`);
  assert.equal(devUrlFromRigConf(rig), `http://localhost:${port}`);
  assert.equal(await resolveBase(undefined, rig, "qa-sweep"), `http://localhost:${port}`);
});

test("resolveBase: a DEV_URL nobody is serving fails LOUDLY (undefined), never a silent sweep", async () => {
  const rig = mkRig("http://localhost:59981");
  assert.equal(await resolveBase(undefined, rig, "qa-sweep"), undefined);
});

test("resolveBase: no --base and no rig.conf = refuse to guess; explicit file:// passes unprobed", async () => {
  const rig = mkRig(undefined);
  assert.equal(await resolveBase(undefined, rig, "qa-sweep"), undefined);
  assert.equal(await resolveBase("file:///tmp/x", rig, "axe-check"), "file:///tmp/x");
});

test("qa-sweep CLI: refuses to guess (exit 2) instead of sweeping a hardcoded port", () => {
  const rig = mkRig(undefined);
  try {
    execFileSync("node", ["--import", "tsx", join(CORE, "src", "tools", "qa-sweep.ts"), "--project", rig], {
      cwd: CORE,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.fail("must exit non-zero");
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    assert.equal(err.status, 2);
    assert.match(err.stdout ?? "", /refusing to guess/);
  }
});

test("doctrine pins: scope ack is law on both sides (plan before code, [SCOPE_OK], stall guard, plan UPDATE)", () => {
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(orch, /Coder scope ack \(P7-T4\)/);
  assert.match(orch, /\[SCOPE_OK\]/);
  assert.match(orch, /run-#14\s+overshoot rail/);
  const coder = readFileSync(join(ROOT, "config", "coder.md"), "utf8");
  assert.match(coder, /Scope ack first \(P7-T4\)/);
  assert.match(coder, /wait for `\[SCOPE_OK\]`/);
  assert.match(coder, /Stall guard/);
  assert.match(coder, /plan UPDATE/);
});
