// The loop-polish pack (post-#7 live run, 2026-08-14). Three laws under
// test, each born from a recorded lesson/flaw of that run:
// 1. actor never silently '?' when the runner's badge (CRATE_SEAT) names the
//    caller — the ledger's one-truth grammar (LESSONS #7 + FLAWS).
// 2. THE PAPERWORK GATE: a round-2+ code_ready whose delta leaves
//    PROGRESS.md untouched is refused — ticket #7's round 3 existed only
//    because round 2's remediation outran the docs.
// 3. The port-watch nag never nags browser tooling (chrome/agent-browser/
//    playwright) — the rig taught itself to dismiss them; now it never has to.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTCTL = join(HERE, "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "loop-polish-"));
const GIT = ["-c", "user.email=t@t", "-c", "user.name=t"];

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
      "  changes_needed: code_ready -> implementing",
      "  approved: code_ready -> approved",
    ].join("\n"),
  );
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: rig });
  writeFileSync(join(rig, "PROGRESS.md"), "# progress\n");
  execFileSync("git", [...GIT, "add", "-A"], { cwd: rig });
  execFileSync("git", [...GIT, "commit", "--quiet", "-m", "init"], { cwd: rig });
  return rig;
}

function ctl(rig: string, seat: string | undefined, ...args: string[]): { ok: boolean; out: string } {
  const env = { ...process.env };
  delete env.CRATE_SEAT;
  if (seat) env.CRATE_SEAT = seat;
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8", env }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

function head(rig: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: rig, encoding: "utf8" }).trim();
}
function commitTouch(rig: string, file: string, msg: string): void {
  writeFileSync(join(rig, file), `${msg}\n${Date.now()}\n`);
  execFileSync("git", [...GIT, "add", "-A"], { cwd: rig });
  execFileSync("git", [...GIT, "commit", "--quiet", "-m", msg], { cwd: rig });
}
function log(rig: string): string {
  return readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
}

test("emit defaults the actor from CRATE_SEAT — the silent '?' is gone where the badge names the caller", () => {
  const rig = makeRig("actor-default");
  try {
    const r = ctl(rig, "coder", "emit", "start_impl");
    assert.equal(r.ok, true, r.out);
    assert.match(log(rig), /START_IMPL actor=coder/, "the badge fills the actor");
    const r2 = ctl(rig, undefined, "emit", "checkpoint");
    assert.equal(r2.ok, true, r2.out);
    assert.match(log(rig), /CHECKPOINT actor=\?/, "a badge-less operator terminal stays '?' exactly as before");
    const r3 = ctl(rig, "coder", "emit", "checkpoint", "--actor", "operator");
    assert.equal(r3.ok, true, r3.out);
    assert.match(log(rig), /CHECKPOINT actor=operator/, "an explicit --actor still wins over the badge");
  } finally {
    rmSync(rig, { recursive: true, force: true });
  }
});

test("THE PAPERWORK GATE: round-2+ code_ready with PROGRESS.md untouched is refused; touching the docs clears it", () => {
  const rig = makeRig("paperwork");
  try {
    assert.equal(ctl(rig, "coder", "emit", "start_impl").ok, true);
    // round 1: free — the reviewer owns first-round doc judgment
    commitTouch(rig, "src.txt", "feature work");
    const r1 = ctl(rig, "coder", "emit", "code_ready", `commit=${head(rig)}`);
    assert.equal(r1.ok, true, r1.out);
    assert.equal(ctl(rig, "orchestrator", "emit", "changes_needed").ok, true);
    // round 2 WITHOUT touching PROGRESS.md → refused before review
    commitTouch(rig, "src.txt", "remediation");
    const r2 = ctl(rig, "coder", "emit", "code_ready", `commit=${head(rig)}`);
    assert.equal(r2.ok, false, "the gate must refuse");
    assert.match(r2.out, /PROGRESS\.md is untouched/, "the refusal names the exact failure");
    assert.match(log(rig), /REJECTED event=code_ready .*reason=stale_docs/, "the refusal is stamped to the ledger");
    // record the round → the gate opens
    commitTouch(rig, "PROGRESS.md", "round 2: remediation recorded");
    const r3 = ctl(rig, "coder", "emit", "code_ready", `commit=${head(rig)}`);
    assert.equal(r3.ok, true, r3.out);
  } finally {
    rmSync(rig, { recursive: true, force: true });
  }
});

test("the paperwork gate stays out of the way: no PROGRESS.md = no gate (not every rig keeps one)", () => {
  const rig = makeRig("no-progress");
  try {
    execFileSync("git", [...GIT, "rm", "--quiet", "PROGRESS.md"], { cwd: rig });
    execFileSync("git", [...GIT, "commit", "--quiet", "-m", "no docs here"], { cwd: rig });
    assert.equal(ctl(rig, "coder", "emit", "start_impl").ok, true);
    commitTouch(rig, "src.txt", "r1");
    assert.equal(ctl(rig, "coder", "emit", "code_ready", `commit=${head(rig)}`).ok, true);
    assert.equal(ctl(rig, "orchestrator", "emit", "changes_needed").ok, true);
    commitTouch(rig, "src.txt", "r2");
    const r = ctl(rig, "coder", "emit", "code_ready", `commit=${head(rig)}`);
    assert.equal(r.ok, true, r.out);
  } finally {
    rmSync(rig, { recursive: true, force: true });
  }
});

test("the port-watch nag skips browser tooling — chrome/agent-browser/playwright listeners never nag", () => {
  const src = readFileSync(join(HERE, "..", "src", "gui", "servers.ts"), "utf8");
  const nag = src.slice(src.indexOf("export function nagUnregistered"));
  assert.ok(/chrom\|agent-browser\|headless_shell\|playwright/.test(nag), "the tooling patterns are filtered");
  assert.ok(nag.indexOf("agent-browser") < nag.indexOf("const key ="), "the filter runs BEFORE the dedup marker — tooling never even burns its key");
});
