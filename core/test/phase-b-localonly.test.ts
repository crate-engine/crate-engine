// PHASE-B #3 — local-only first-class: attach gives origin-less repos a local
// origin mirror (.agents/mirror.git), and nm-gate has a codified no-origin
// path (the testuser8 rig's [engine] flaw, ported to the brain FLAWS).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { executeAttach, planAttach, resolveTarget } from "../src/attach.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-localonly-"));
const BRAIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeEngine(): string {
  const engine = join(scratch, "engine");
  for (const d of ["bin", "config", "adapters"]) mkdirSync(join(engine, d), { recursive: true });
  mkdirSync(join(engine, "templates", "state", "checkpoints"), { recursive: true });
  for (const doc of ["AGENTS.md", "PROGRESS.md", "ISSUES.md"]) {
    writeFileSync(join(engine, "templates", doc), `# ${doc} — {{PROJECT}}\n`);
  }
  writeFileSync(join(engine, "templates", "state", "FLAWS.md"), "# FLAWS — {{PROJECT}}\n");
  return engine;
}
const engine = makeEngine();

const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });

test("create-mode attach sets up a local origin mirror and pushes the first commit", () => {
  const plan = planAttach(resolveTarget("fresh", { projectsRoot: join(scratch, "projects") }), engine, { create: true });
  assert.ok(plan.writes.some((w) => w.rel === ".agents/mirror.git" && w.action === "create"), "mirror disclosed");
  const report = executeAttach(plan);
  const root = plan.projectRoot;
  assert.equal(report.originMirror, join(root, ".agents", "mirror.git"));
  assert.equal(git(["remote", "get-url", "origin"], root).trim(), join(root, ".agents", "mirror.git"));
  // the first commit is on the mirror: origin/<default branch> resolves to HEAD
  const head = git(["rev-parse", "HEAD"], root).trim();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
  assert.equal(git(["rev-parse", `origin/${branch}`], root).trim(), head, "first commit pushed to the mirror");
});

test("attaching a git repo that already has an origin leaves it alone", () => {
  const repo = join(scratch, "has-origin");
  mkdirSync(repo, { recursive: true });
  git(["init", "--quiet"], repo);
  git(["remote", "add", "origin", "https://example.com/x.git"], repo);
  const plan = planAttach(resolveTarget(repo, { cwd: "/" }), engine);
  assert.ok(!plan.writes.some((w) => w.rel === ".agents/mirror.git"), "no mirror for a remoted repo");
  executeAttach(plan);
  assert.equal(git(["remote", "get-url", "origin"], repo).trim(), "https://example.com/x.git");
});

// ── nm-gate: the codified no-origin path, exercised against the REAL script ──

/** A rig-shaped repo: main + a feature branch, .agents/bin carrying the real
 * nm-gate and a stub precheck (the gate's delta logic is what's under test). */
function makeGateRepo(name: string): string {
  const repo = join(scratch, name);
  mkdirSync(join(repo, ".agents", "bin"), { recursive: true });
  git(["init", "--quiet", "-b", "main"], repo);
  writeFileSync(join(repo, "app.ts"), "export {}\n");
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", "init"], repo);
  git(["checkout", "--quiet", "-b", "feature"], repo);
  writeFileSync(join(repo, "feature.ts"), "export {}\n");
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", "feature work"], repo);
  git(["checkout", "--quiet", "main"], repo);
  copyFileSync(join(BRAIN, "bin", "nm-gate"), join(repo, ".agents", "bin", "nm-gate"));
  writeFileSync(join(repo, ".agents", "bin", "precheck.sh"), "#!/bin/bash\nexit 0\n");
  chmodSync(join(repo, ".agents", "bin", "precheck.sh"), 0o755);
  return repo;
}

const gate = (repo: string, ref: string) =>
  execFileSync("bash", [join(repo, ".agents", "bin", "nm-gate"), "--quick", ref], { cwd: repo, encoding: "utf8" });

test("nm-gate gates a NO-origin repo against local main, says so, and passes", () => {
  const repo = makeGateRepo("gate-noorigin");
  const out = gate(repo, "feature");
  assert.match(out, /local-only repo; delta gated against local main/);
  assert.match(out, /--quick PASS/);
});

test("nm-gate refreshes a stale local-mirror origin/main at gate time", () => {
  const repo = makeGateRepo("gate-mirror");
  const mirror = join(repo, ".agents", "mirror.git");
  execFileSync("git", ["init", "--bare", "--quiet", mirror]);
  git(["remote", "add", "origin", mirror], repo);
  git(["push", "--quiet", "-u", "origin", "main"], repo);
  // main moves on locally — the mirror is now stale
  writeFileSync(join(repo, "later.ts"), "export {}\n");
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", "mainline moved"], repo);
  const out = gate(repo, "feature");
  assert.match(out, /--quick PASS/);
  const localMain = git(["rev-parse", "main"], repo).trim();
  assert.equal(git(["rev-parse", "origin/main"], repo).trim(), localMain, "gate-time sync refreshed the mirror");
});

test("nm-gate still FAILS an empty delta honestly on a local-only repo", () => {
  const repo = makeGateRepo("gate-nodelta");
  assert.throws(
    () => gate(repo, "main"),
    (e: unknown) => /FAIL delta/.test(String((e as { stdout?: string }).stdout ?? e)),
    "gating main against itself must fail the delta stage",
  );
});
