// THE FLYWHEEL COMMIT (2026-07-25; FLAWS "rig working docs can stay
// UNCOMMITTED forever"): `emit close` mechanically commits the three working
// docs' accruals — docs only (never a sweep), mainline-only (concurrent-loop
// safety), identity fallback, index.lock retry, best-effort push, loud
// warnings but never a wedge. Attach-mode also commits the scaffolds it
// creates. Drives the REAL bin/agentctl.py + core attach.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { planAttach, executeAttach, resolveTarget } from "../src/attach.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTCTL = join(ROOT, "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-flywheel-"));

function git(rig: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: rig, encoding: "utf8" }).trim();
}

function ctl(rig: string, ...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8" }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** A rig at state=deployed with UNTRACKED working docs (the leak shape). */
function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(rig, { recursive: true });
  git(rig, "init", "-qb", "main");
  git(rig, "config", "user.email", "t@t");
  git(rig, "config", "user.name", "t");
  writeFileSync(join(rig, "app.txt"), "hello\n");
  git(rig, "add", "-A");
  git(rig, "commit", "-qm", "base");
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  for (const f of ["state-machine.yaml", "handoffs.yaml"]) {
    writeFileSync(
      join(rig, ".agents", "config", f),
      f === "handoffs.yaml"
        ? "handoffs:\n"
        : [
            "initial: idle",
            "always_legal: checkpoint, gate_pass, gate_release, verdict",
            "transitions:",
            "  start_impl: idle -> implementing",
            "  code_ready: implementing -> code_ready",
            "  approved: code_ready -> approved",
            "  deployed: approved -> deployed",
            "  close: deployed -> idle",
          ].join("\n"),
    );
  }
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  writeFileSync(join(rig, ".gitignore"), ".agents/\n");
  // the leak shape: accrued docs, never committed
  writeFileSync(join(rig, "AGENTS.md"), "# law\n\n## Critical Paths\n1. Home (/) — loads\n");
  writeFileSync(join(rig, "PROGRESS.md"), "loop 1 done\n");
  writeFileSync(join(rig, "ISSUES.md"), "none\n");
  return rig;
}

function driveToDeployed(rig: string): void {
  ctl(rig, "emit", "start_impl", "--actor", "orchestrator");
  ctl(rig, "emit", "code_ready", "--actor", "coder");
  ctl(rig, "emit", "approved", "--actor", "orchestrator");
  ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  const d = ctl(rig, "emit", "deployed", "--actor", "coder");
  assert.ok(d.ok, d.out);
}

test("close commits ONLY the three docs — a dirty source file is untouched (never a sweep)", () => {
  const rig = makeRig("scope");
  driveToDeployed(rig);
  writeFileSync(join(rig, "app.txt"), "hello CHANGED — must not ride the docs commit\n");
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /DOCS COMMITTED/);
  const show = git(rig, "show", "--stat", "--name-only", "HEAD");
  assert.match(show, /AGENTS\.md/);
  assert.match(show, /PROGRESS\.md/);
  assert.doesNotMatch(show, /app\.txt/, "the sweep is forbidden — docs only");
  assert.match(git(rig, "status", "--porcelain"), /app\.txt/, "the source edit stays uncommitted");
});

test("clean docs → close makes NO commit (no empty commits)", () => {
  const rig = makeRig("clean");
  git(rig, "add", "AGENTS.md", "PROGRESS.md", "ISSUES.md");
  git(rig, "commit", "-qm", "docs committed already");
  driveToDeployed(rig);
  const before = git(rig, "rev-parse", "HEAD");
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.ok(r.ok, r.out);
  assert.doesNotMatch(r.out, /DOCS COMMITTED/);
  assert.equal(git(rig, "rev-parse", "HEAD"), before);
});

test("no git identity → the attach fallback identity commits anyway", () => {
  const rig = makeRig("identity");
  git(rig, "config", "--unset", "user.email");
  git(rig, "config", "--unset", "user.name");
  driveToDeployed(rig);
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  // (if the machine has a global identity this passes on the plain path; the
  // fallback path is what makes it pass on a FRESH account — both are green)
  assert.match(r.out, /DOCS COMMITTED/);
});

test("close on a NON-mainline branch: loud warning, NO commit (concurrent-loop safety)", () => {
  const rig = makeRig("branch");
  driveToDeployed(rig);
  git(rig, "checkout", "-qb", "feature/other");
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.ok(r.ok, "the close itself must never wedge");
  assert.match(r.out, /DOCS: accrual NOT committed/);
  assert.doesNotMatch(git(rig, "log", "--oneline", "-1"), /accrual/);
});

test("a held index.lock: close still lands, docs warning is loud, nothing is silently lost", () => {
  const rig = makeRig("lock");
  driveToDeployed(rig);
  writeFileSync(join(rig, ".git", "index.lock"), "held by a racing process");
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.ok(r.ok, "a doc-commit failure must never block the close");
  assert.match(r.out, /DOCS: WARNING — could not commit/);
  rmSync(join(rig, ".git", "index.lock"));
  assert.match(git(rig, "status", "--porcelain"), /AGENTS\.md/, "docs stay dirty for the next close/hand-commit");
});

test("with an origin, the docs commit is PUSHED (the mirror never goes stale)", () => {
  const rig = makeRig("push");
  const bare = join(scratch, "push-origin.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(rig, "remote", "add", "origin", bare);
  git(rig, "push", "-qu", "origin", "main");
  driveToDeployed(rig);
  const r = ctl(rig, "emit", "close", "--actor", "orchestrator");
  assert.match(r.out, /DOCS COMMITTED: .*pushed/);
  const originTip = execFileSync("git", ["rev-parse", "main"], { cwd: bare, encoding: "utf8" }).trim();
  assert.equal(originTip, git(rig, "rev-parse", "HEAD"));
});

test("attach-mode commits the doc scaffolds it CREATES (the promise the code now keeps)", () => {
  const proj = join(scratch, "attach-proj");
  mkdirSync(proj, { recursive: true });
  execFileSync("git", ["init", "-qb", "main"], { cwd: proj });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: proj });
  execFileSync("git", ["config", "user.name", "t"], { cwd: proj });
  writeFileSync(join(proj, "app.txt"), "code\n");
  execFileSync("git", ["add", "-A"], { cwd: proj });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: proj });
  // a miniature engine shaped like the brain (the attach.test.ts fixture law)
  const engine = join(scratch, "mini-engine");
  for (const d of ["bin", "config", "adapters"]) mkdirSync(join(engine, d), { recursive: true });
  mkdirSync(join(engine, "templates", "state"), { recursive: true });
  for (const doc of ["AGENTS.md", "PROGRESS.md", "ISSUES.md"]) {
    writeFileSync(join(engine, "templates", doc), `# ${doc} — {{PROJECT}}\n`);
  }
  writeFileSync(join(engine, "templates", "state", "FLAWS.md"), "# FLAWS — {{PROJECT}}\n");
  const plan = planAttach(resolveTarget(proj, { cwd: "/" }), engine);
  executeAttach(plan);
  assert.ok(existsSync(join(proj, "AGENTS.md")));
  const last = execFileSync("git", ["show", "--stat", "--name-only", "HEAD"], { cwd: proj, encoding: "utf8" });
  assert.match(last, /AGENTS\.md/, "attach must commit the scaffolds it writes");
  const st = execFileSync("git", ["status", "--porcelain", "--", "AGENTS.md", "PROGRESS.md", "ISSUES.md"], {
    cwd: proj, encoding: "utf8",
  }).trim();
  assert.equal(st, "", "no working-doc left untracked after attach");
});
