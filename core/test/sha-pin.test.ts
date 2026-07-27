// Run #14: the Coder pushed a second commit AFTER emitting code_ready, so
// Reviewer reviewed one sha while QA tested another — the orchestrator caught
// it by hand. This pins the reviewed sha mechanically: code_ready records the
// tip, approved REJECTS when the branch moved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-shapin-"));

// An attached project that is a REAL git repo on a feature branch.
const rig = join(scratch, "rig");
mkdirSync(join(rig, ".agents", "state"), { recursive: true });
mkdirSync(join(rig, ".agents", "config"), { recursive: true });
writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
writeFileSync(
  join(rig, ".agents", "config", "state-machine.yaml"),
  [
    "initial: idle",
    "always_legal:",
    "transitions:",
    "  start_impl: idle -> implementing",
    "  code_ready: implementing -> code_ready",
    "  changes_needed: code_ready -> implementing",
    "  approved: code_ready -> approved",
  ].join("\n"),
);
writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
writeFileSync(join(rig, ".agents", "state", "events.log"), "");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: rig, encoding: "utf8" }).trim();
}
git("init", "-q", "-b", "main");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root");
git("checkout", "-q", "-b", "feature/x");
writeFileSync(join(rig, "a.txt"), "one\n");
git("add", "a.txt");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one");

function ctl(...args: string[]): { out: string; code: number } {
  try {
    return { out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8" }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

test("code_ready pins the tip sha (file + event line + FROZEN notice)", () => {
  assert.equal(ctl("emit", "start_impl", "--actor", "orchestrator").code, 0);
  const r = ctl("emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.equal(r.code, 0);
  assert.match(r.out, /PINNED: feature\/x frozen at [0-9a-f]{9}/);
  const pin = readFileSync(join(rig, ".agents", "state", "pin-code_ready"), "utf8");
  assert.match(pin, new RegExp(`sha=${git("rev-parse", "HEAD")}`));
  assert.match(pin, /branch=feature\/x/);
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  assert.match(log, /CODE_READY .*sha=[0-9a-f]{9}/);
});

test("approved REJECTS when the branch moved after the pin — state untouched, recovery named", () => {
  writeFileSync(join(rig, "a.txt"), "two\n");
  git("add", "a.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "sneaky post-emit commit");
  const r = ctl("emit", "approved", "--actor", "orchestrator");
  assert.equal(r.code, 1, "the join must refuse");
  assert.match(r.out, /REJECTED: the branch moved after code_ready/);
  assert.match(r.out, /changes_needed/); // the honest recovery path is named
  assert.equal(ctl("state").out.trim(), "code_ready", "a rejected join must not change state");
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  assert.match(log, /REJECTED event=approved .*reason=branch_moved/);
});

test("re-emitting code_ready re-pins the new tip; approved then joins cleanly", () => {
  assert.equal(ctl("emit", "changes_needed", "--actor", "orchestrator").code, 0);
  assert.equal(ctl("emit", "code_ready", "--actor", "coder").code, 0); // re-pin at the new tip
  const r = ctl("emit", "approved", "--actor", "orchestrator");
  assert.equal(r.code, 0);
  assert.match(r.out, /OK: approved/);
});

test("no pin on file → approved warns plainly but does not block (legacy/mid-flight rigs)", () => {
  const bare = join(scratch, "bare-rig");
  mkdirSync(join(bare, ".agents", "state"), { recursive: true });
  mkdirSync(join(bare, ".agents", "config"), { recursive: true });
  writeFileSync(join(bare, ".agents", "rig.conf"), 'PROJECT="bare"\n');
  writeFileSync(
    join(bare, ".agents", "config", "state-machine.yaml"),
    "initial: code_ready\nalways_legal:\ntransitions:\n  approved: code_ready -> approved\n",
  );
  writeFileSync(join(bare, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(bare, ".agents", "state", "events.log"), "");
  const out = execFileSync("python3", [AGENTCTL, "emit", "approved", "--actor", "orchestrator"], {
    cwd: bare,
    encoding: "utf8",
  });
  assert.match(out, /WARNING: no code_ready pin on file/);
  assert.match(out, /OK: approved/);
  assert.ok(!existsSync(join(bare, ".agents", "state", "pin-code_ready")));
});
