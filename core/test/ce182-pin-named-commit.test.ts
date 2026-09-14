// CE-182 (docket loop, 2026-09-13): `emit code_ready` must pin the commit the
// CODER names, not the rig root's checkout. A worktree-built feature emitted
// from a root still on main got pinned as main — the orchestrator caught it
// by hand; this makes the catch unnecessary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}
function makeRig(): { rig: string; mainSha: string; featSha: string } {
  const rig = mkdtempSync(join(tmpdir(), "ce182-"));
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  writeFileSync(join(rig, ".agents", "config", "state-machine.yaml"), [
    "initial: idle", "always_legal: checkpoint, gate_pass, gate_release", "transitions:",
    "  start_impl: idle -> implementing", "  code_ready: implementing -> code_ready", "  approved: code_ready -> approved",
  ].join("\n"));
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  git(rig, "init", "-q", "-b", "main");
  writeFileSync(join(rig, "a.txt"), "main\n"); git(rig, "add", "a.txt"); git(rig, "commit", "-qm", "main");
  const mainSha = git(rig, "rev-parse", "HEAD");
  // the feature is built OFF the root checkout (a worktree flow): a branch with a commit, root stays on main
  git(rig, "branch", "feature/x");
  const wt = join(rig, ".agents", "state", "wt");
  git(rig, "worktree", "add", "-q", wt, "feature/x");
  writeFileSync(join(wt, "a.txt"), "feature\n"); git(wt, "commit", "-qam", "feat");
  const featSha = git(rig, "rev-parse", "feature/x");
  assert.equal(git(rig, "rev-parse", "HEAD"), mainSha, "root stays on main");
  return { rig, mainSha, featSha };
}
function ctl(rig: string, ...args: string[]): { ok: boolean; out: string } {
  const env = { ...process.env }; delete env.CRATE_SEAT;
  try { return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8", env }) }; }
  catch (e) { const err = e as { stdout?: string; stderr?: string }; return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") }; }
}
const pin = (rig: string) => readFileSync(join(rig, ".agents", "state", "pin-code_ready"), "utf8").trim();

test("code_ready pins the NAMED commit + branch (abbreviated sha accepted), not the root's HEAD", () => {
  const { rig, mainSha, featSha } = makeRig();
  try {
    assert.ok(ctl(rig, "emit", "start_impl", "--actor", "orchestrator").ok);
    const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x", `commit=${featSha.slice(0, 8)}`);
    assert.ok(r.ok, r.out);
    const p = pin(rig);
    assert.ok(p.includes(`sha=${featSha}`), `pinned the feature commit, full sha: ${p}`);
    assert.ok(p.includes("branch=feature/x"), `pinned the feature branch: ${p}`);
    assert.ok(!p.includes(mainSha), "the root's main HEAD is NOT the pin (the docket case)");
    assert.match(r.out, /PINNED: feature\/x frozen at/);
  } finally { rmSync(rig, { recursive: true, force: true }); }
});

test("a named commit git cannot resolve is REFUSED in plain words — never a silent HEAD pin", () => {
  const { rig } = makeRig();
  try {
    assert.ok(ctl(rig, "emit", "start_impl", "--actor", "orchestrator").ok);
    const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x", "commit=deadbeefcafe");
    assert.equal(r.ok, false);
    assert.match(r.out, /REFUSED: code_ready names commit deadbeefcafe but git cannot resolve it/);
  } finally { rmSync(rig, { recursive: true, force: true }); }
});

test("with nothing named, the checkout's HEAD stays the pin (the in-place flow)", () => {
  const { rig, mainSha } = makeRig();
  try {
    assert.ok(ctl(rig, "emit", "start_impl", "--actor", "orchestrator").ok);
    assert.ok(ctl(rig, "emit", "code_ready", "--actor", "coder").ok);
    assert.ok(pin(rig).includes(`sha=${mainSha}`) && pin(rig).includes("branch=main"));
  } finally { rmSync(rig, { recursive: true, force: true }); }
});
