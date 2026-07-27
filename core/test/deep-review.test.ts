// PHASE-7 T2b — the deep-quality review mode's MECHANICAL leg, driven through
// the REAL bin/review-signals in scratch git repos, plus the doctrine pins the
// live loop must fire. The trigger is ON BY DEFAULT and AGENTS.md-tunable;
// a pre-existing oversized file is context, not this PR's crime.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-deeprev-"));

const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i};`).join("\n") + "\n";

let n = 0;
/** A scratch rig: main + a "feat" branch whose files are given per-branch. */
function mkRig(mainFiles: Record<string, string>, featFiles: Record<string, string>): string {
  const rig = join(scratch, `rig${++n}`);
  mkdirSync(join(rig, ".agents"), { recursive: true });
  symlinkSync(join(ROOT, "bin"), join(rig, ".agents", "bin"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: rig, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  for (const [rel, c] of Object.entries(mainFiles)) writeFileSync(join(rig, rel), c);
  git("add", "-A");
  git("commit", "-qm", "init");
  git("checkout", "-qb", "feat");
  for (const [rel, c] of Object.entries(featFiles)) writeFileSync(join(rig, rel), c);
  git("add", "-A");
  git("commit", "-qm", "feature");
  git("checkout", "-q", "main");
  return rig;
}

function signals(rig: string): string {
  return execFileSync("bash", [join(rig, ".agents", "bin", "review-signals"), "feat"], {
    cwd: rig,
    encoding: "utf8",
  });
}

test("a file the PR pushes past the boundary → RECOMMENDED with the crossing named", () => {
  const rig = mkRig({ "big.js": lines(990, "a") }, { "big.js": lines(1010, "a") });
  const out = signals(rig);
  assert.match(out, /CROSSED big\.js 990->1010 lines \(boundary 1000\)/);
  assert.match(out, /DEEP-REVIEW: RECOMMENDED \(.*file-crossed-boundary.*\)/);
});

test("a pre-existing oversized file is NOT this PR's crime", () => {
  const rig = mkRig({ "big.js": lines(1200, "a") }, { "big.js": lines(1210, "a") });
  const out = signals(rig);
  assert.doesNotMatch(out, /CROSSED/);
  assert.match(out, /DEEP-REVIEW: no/);
});

test("an oversized diff → RECOMMENDED even with no single file crossing", () => {
  const rig = mkRig({ "a.js": lines(10, "a") }, { "a.js": lines(10, "a"), "b.js": lines(600, "b") });
  const out = signals(rig);
  assert.match(out, /DIFF \d+ changed lines across \d+ files/);
  assert.match(out, /DEEP-REVIEW: RECOMMENDED \(.*oversized-diff.*\)/);
});

test("a small clean change stays quiet (no cost added to normal loops)", () => {
  const rig = mkRig({ "a.js": lines(20, "a") }, { "a.js": lines(25, "a") });
  assert.match(signals(rig), /DEEP-REVIEW: no/);
});

test("AGENTS.md tunes the boundaries (branch's own copy wins)", () => {
  const agents = "# p\n\n## Review Standards\n\n- Deep-review file boundary: 100\n- Deep-review diff boundary: 40\n";
  const rig = mkRig({ "AGENTS.md": agents, "a.js": lines(90, "a") }, { "AGENTS.md": agents, "a.js": lines(120, "a") });
  const out = signals(rig);
  assert.match(out, /CROSSED a\.js 90->120 lines \(boundary 100\)/);
  assert.match(out, /RECOMMENDED/);
});

test("AGENTS.md '- Deep review: off' disables the posture entirely", () => {
  const agents = "# p\n\n## Review Standards\n\n- Deep review: off\n";
  const rig = mkRig({ "AGENTS.md": agents, "a.js": lines(10, "a") }, { "AGENTS.md": agents, "a.js": lines(2000, "a") });
  const out = signals(rig);
  assert.equal(out.trim(), "DEEP-REVIEW: disabled (AGENTS.md)");
});

test("doctrine pins: skill card + reviewer depth section + orchestrator depth axis + procedure step + credit", () => {
  const skill = readFileSync(join(ROOT, "config", "skills", "deep-quality-review.md"), "utf8");
  assert.match(skill, /\[DEEP_REVIEW\] dispatches only/);
  assert.match(skill, /Severity translation is LAW/);
  assert.match(skill, /SHOULD-FIX tagged\s+\*\*`\[quality\]`\*\*|SHOULD-FIX tagged/);
  assert.match(skill, /Inspired by Mat[\s>]+Paddock/);
  const reviewer = readFileSync(join(ROOT, "config", "reviewer.md"), "utf8");
  assert.match(reviewer, /## Review depth \(standard vs deep\)/);
  assert.match(reviewer, /Never\s+self-escalate/);
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(orch, /Pick the DEPTH/);
  assert.match(orch, /review-signals/);
  assert.match(orch, /### \.deep-review/);
  const proc = readFileSync(join(ROOT, "config", "procedures", "pre-review-checks.md"), "utf8");
  assert.match(proc, /review-signals <branch>/);
});
