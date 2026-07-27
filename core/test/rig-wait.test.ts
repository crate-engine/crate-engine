// Run #14: the orchestrator improvised its backstop watcher inline TWICE
// because rig-wait.sh wasn't shipped in the box. Now it is (bin/rig-wait.sh,
// reached via .agents/bin): state mode + verdict-files mode, no v1 conf
// coupling (the caller's cwd IS the rig).
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin");
const RIGWAIT = join(BIN, "rig-wait.sh");
const scratch = mkdtempSync(join(tmpdir(), "crate2-rigwait-"));

const rig = join(scratch, "rig");
mkdirSync(join(rig, ".agents", "state"), { recursive: true });
mkdirSync(join(rig, ".agents", "config"), { recursive: true });
mkdirSync(join(rig, ".agents", "bin"), { recursive: true });
writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
writeFileSync(
  join(rig, ".agents", "config", "state-machine.yaml"),
  "initial: idle\nalways_legal:\ntransitions:\n  start_impl: idle -> implementing\n",
);
writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
writeFileSync(join(rig, ".agents", "state", "events.log"), "");
// the project reaches the tools via .agents/bin — mirror that wiring
execFileSync("ln", ["-s", join(BIN, "agentctl.py"), join(rig, ".agents", "bin", "agentctl.py")]);
execFileSync("ln", ["-s", RIGWAIT, join(rig, ".agents", "bin", "rig-wait.sh")]);

function runWait(args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile("bash", [".agents/bin/rig-wait.sh", ...args], { cwd: rig, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ out: `${stdout}${stderr}`, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
    });
  });
}

test("state mode: exits with CHANGED the moment the state leaves baseline", async () => {
  const waiter = runWait(["idle", "1"]);
  await new Promise((r) => setTimeout(r, 1200)); // let it capture the baseline
  execFileSync("python3", [join(BIN, "agentctl.py"), "emit", "start_impl", "--actor", "orchestrator"], { cwd: rig });
  const r = await waiter;
  assert.equal(r.code, 0);
  assert.match(r.out, /CHANGED: implementing/);
});

test("files mode: waits for ALL named verdict files, not just the first", async () => {
  const rev = join(rig, ".agents", "state", "reviewer.md");
  const qa = join(rig, ".agents", "state", "tester.md");
  writeFileSync(rev, "idle\n");
  writeFileSync(qa, "idle\n");
  const past = new Date(Date.now() - 60_000);
  utimesSync(rev, past, past);
  utimesSync(qa, past, past);

  const waiter = runWait(["--files", "reviewer,tester", "1"]);
  await new Promise((r) => setTimeout(r, 1200));
  writeFileSync(rev, "verdict: APPROVED\n"); // only ONE has reported
  await new Promise((r) => setTimeout(r, 2500));
  let done = false;
  void waiter.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(done, false, "must still be waiting on tester.md");

  writeFileSync(qa, "verdict: PASS\n"); // now BOTH have reported
  const r = await waiter;
  assert.equal(r.code, 0);
  assert.match(r.out, /ALL-REPORTED: reviewer,tester/);
});

test("refuses to run outside a project root (no .agents)", async () => {
  const r = await new Promise<{ out: string; code: number }>((resolve) => {
    execFile("bash", [RIGWAIT, "idle"], { cwd: scratch, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ out: `${stdout}${stderr}`, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
    });
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /run from the project root/);
});
