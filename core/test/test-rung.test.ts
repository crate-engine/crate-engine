// PHASE-7 T2 — the gate's stack-aware TEST rung, driven through the REAL
// bin/precheck.sh in scratch git rigs (fixture law: the shipped script, not a
// hand-simplified copy). Pinned detection rule: AGENTS.md "Build & Test
// Commands" `- Test:` line wins; else a package.json test script that is NOT
// npm's placeholder; else the rung is SILENT. Hung suites fail LOUDLY at the
// timeout. Also pinned here: the T2 binder law lines.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-testrung-"));

let n = 0;
/** A scratch rig: git repo, main + a feature branch with a delta, and the
 * REAL engine bin wired at .agents/bin (as attach's symlink does). */
function mkGateRig(files: Record<string, string>): string {
  const rig = join(scratch, `rig${++n}`);
  mkdirSync(join(rig, ".agents"), { recursive: true });
  symlinkSync(join(ROOT, "bin"), join(rig, ".agents", "bin"));
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  const git = (...a: string[]) => execFileSync("git", a, { cwd: rig, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(rig, "README.md"), "# rig\n");
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(rig, rel), content);
  git("add", "-A");
  git("commit", "-qm", "init");
  git("checkout", "-qb", "feat");
  writeFileSync(join(rig, "feature.txt"), "the change\n");
  git("add", "-A");
  git("commit", "-qm", "feature");
  git("checkout", "-q", "main");
  return rig;
}

function gate(rig: string, env: Record<string, string> = {}): { out: string; code: number } {
  try {
    return {
      out: execFileSync("bash", [join(rig, ".agents", "bin", "precheck.sh"), "feat"], {
        cwd: rig,
        encoding: "utf8",
        env: { ...process.env, ...env },
        timeout: 120_000,
      }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

test("with-runner: a real passing test script runs and passes the gate", () => {
  const rig = mkGateRig({
    "package.json": JSON.stringify({ name: "r", scripts: { test: "node -e 'process.exit(0)'" } }),
  });
  const r = gate(rig);
  assert.match(r.out, /TEST: {6}PASS \(package\.json: npm test/);
  assert.match(r.out, /RESULT: REQUIRED CHECKS PASS/);
  assert.equal(r.code, 0);
});

test("broken test: a failing suite FAILS the gate", () => {
  const rig = mkGateRig({
    "package.json": JSON.stringify({ name: "r", scripts: { test: "node -e 'process.exit(1)'" } }),
  });
  const r = gate(rig);
  assert.match(r.out, /TEST: {6}FAIL/);
  assert.match(r.out, /RESULT: FAIL \(.*TEST.*\)/);
  assert.equal(r.code, 1);
});

test("npm's placeholder test script is NOT a runner — rung silent, gate green (the greenfield-npm-init trap)", () => {
  const rig = mkGateRig({
    "package.json": JSON.stringify({
      name: "r",
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }),
  });
  const r = gate(rig);
  assert.match(r.out, /TEST: {6}SKIPPED/);
  assert.match(r.out, /RESULT: REQUIRED CHECKS PASS/);
  assert.equal(r.code, 0);
});

test("greenfield (no package.json at all): typecheck/build/test all skip, gate green", () => {
  const rig = mkGateRig({ "index.html": "<h1>hi</h1>\n" });
  const r = gate(rig);
  assert.match(r.out, /TYPECHECK: SKIPPED/);
  assert.match(r.out, /BUILD: {5}SKIPPED/);
  assert.match(r.out, /TEST: {6}SKIPPED/);
  assert.match(r.out, /RESULT: REQUIRED CHECKS PASS/);
  assert.equal(r.code, 0);
});

test("AGENTS.md-declared test command wins (no package.json needed) and runs verbatim", () => {
  const rig = mkGateRig({
    "AGENTS.md": "# rig\n\n## Build & Test Commands\n\n- Build: none\n- Test: `sh run-tests.sh`\n\n## Other\n",
    "run-tests.sh": 'echo "custom runner ran"\nexit 0\n',
  });
  const r = gate(rig);
  assert.match(r.out, /TEST: {6}PASS \(AGENTS\.md: sh run-tests\.sh/);
  assert.equal(r.code, 0);
});

test("AGENTS.md '- Test: none' means NO runner — rung silent even with a package.json test script", () => {
  const rig = mkGateRig({
    "AGENTS.md": "# rig\n\n## Build & Test Commands\n\n- Test: none configured\n",
    "package.json": JSON.stringify({ name: "r", scripts: { test: "node -e 'process.exit(1)'" } }),
  });
  const r = gate(rig);
  // the explicit AGENTS.md "none" wins over package.json — pinned precedence:
  // AGENTS.md is the project law; a declared "none" is a decision, not an absence
  assert.match(r.out, /TEST: {6}SKIPPED/);
  assert.equal(r.code, 0);
});

test("hung suite: fails LOUDLY at the timeout instead of wedging the loop", () => {
  const rig = mkGateRig({
    "package.json": JSON.stringify({
      name: "r",
      scripts: { test: "node -e 'setTimeout(()=>{},120000)'" },
    }),
  });
  const start = Date.now();
  const r = gate(rig, { NMGATE_TEST_TIMEOUT: "3" });
  assert.ok(Date.now() - start < 60_000, "the gate must return promptly, not wedge");
  assert.match(r.out, /TEST: {6}TIMEOUT/);
  assert.match(r.out, /TIMED OUT after 3s/);
  assert.match(r.out, /RESULT: FAIL \(.*TEST\(TIMEOUT\).*\)/);
  assert.equal(r.code, 1);
});

test("binder law pinned: coder ships tests when a runner exists; template marks the - Test: hook", () => {
  const coder = readFileSync(join(ROOT, "config", "coder.md"), "utf8");
  assert.match(coder, /Tests ride the change — when the project HAS a test runner/);
  assert.match(coder, /never bolt a framework onto/i);
  const tpl = readFileSync(join(ROOT, "templates", "AGENTS.md"), "utf8");
  assert.match(tpl, /`- Test:` line is LOAD-BEARING/);
});

test("required smoke refuses a non-web project with no runnable smoke; explicit exemption remains possible", () => {
  const rig = mkGateRig({ "tool.py": "print('non-web fixture')\n" });
  const required = gate(rig, { SMOKE_ENFORCE: "1" });
  assert.equal(required.code, 1, required.out);
  assert.match(required.out, /SMOKE\(SKIPPED\)/);
  assert.match(required.out, /no-web-smoke/);
  const exempt = gate(rig, { SMOKE_ENFORCE: "0" });
  assert.equal(exempt.code, 0, exempt.out);
  assert.doesNotMatch(exempt.out, /ALL PASS/);
  assert.match(exempt.out, /RESULT: REQUIRED CHECKS PASS/);
  assert.match(exempt.out, /SMOKE=SKIPPED/);
});

test("failed advisory smoke stays visible; required smoke blocks", t => {
  const rig = mkGateRig({
    "index.html": "<h1>Fixture</h1>",
    "AGENTS.md": "## Critical Paths\n1. Home (/) — loads\n2. Missing (/missing) — fails\n",
  });
  const advisory = gate(rig, { SMOKE_ENFORCE: "0" });
  if (!/ROUTE \/missing: FAIL/.test(advisory.out)) {
    assert.match(advisory.out, /SMOKE: +(?:SKIPPED|ERROR)|no playwright browser/);
    t.skip("browser smoke prerequisites unavailable on this host");
    return;
  }
  assert.equal(advisory.code, 0, advisory.out);
  assert.doesNotMatch(advisory.out, /ALL PASS/);
  assert.match(advisory.out, /RESULT: REQUIRED CHECKS PASS.*SMOKE=FAIL/);
  const required = gate(rig, { SMOKE_ENFORCE: "1" });
  assert.equal(required.code, 1, required.out);
  assert.match(required.out, /RESULT: FAIL.*SMOKE\(FAIL\)/);
});

test("nm-gate never describes skipped checks as all passed", () => {
  const rig = mkGateRig({ "tool.py": "print('fixture')\n" });
  symlinkSync(join(ROOT, "config"), join(rig, ".agents/config"));
  mkdirSync(join(rig, ".agents/state"));
  writeFileSync(join(rig, ".agents/state/events.log"), "[t] START_IMPL state=implementing\n");
  const out = execFileSync("bash", [join(rig, ".agents/bin/nm-gate"), "feat"], {
    cwd: rig, encoding: "utf8", env: { ...process.env, SMOKE_ENFORCE: "0", CRATE_SEAT: "" },
  });
  assert.doesNotMatch(out, /ALL PASS/);
  assert.match(out, /nm-gate: REQUIRED CHECKS PASS.*gate_pass recorded/);
  assert.match(out, /SMOKE=SKIPPED/);
  assert.match(readFileSync(join(rig, ".agents/state/events.log"), "utf8"), /GATE_PASS/);
});

test("dependency staging removes a partial hardlink tree before copying a real directory", () => {
  const rig = mkGateRig({
    "package.json": JSON.stringify({ name: "fixture", scripts: { test: "node check.cjs" } }),
    "check.cjs": "const fs=require('fs'); if(require('probe')!==42 || fs.existsSync('node_modules/partial') || fs.lstatSync('node_modules').isSymbolicLink()) process.exit(1);\n",
  });
  mkdirSync(join(rig, "node_modules/probe"), { recursive: true });
  writeFileSync(join(rig, "node_modules/probe/index.js"), "module.exports=42;\n");
  const shim = join(rig, "shim"); mkdirSync(shim);
  writeFileSync(join(shim, "cp"), '#!/bin/sh\nif [ "$1" = "-al" ]; then mkdir -p "$3"; touch "$3/partial"; exit 1; fi\n[ "${FAIL_COPY:-0}" = 1 ] && exit 1\nexec /bin/cp "$@"\n');
  chmodSync(join(shim, "cp"), 0o755);
  const env = { PATH: shim + ":" + process.env.PATH };
  const copied = gate(rig, env); assert.equal(copied.code, 0, copied.out); assert.match(copied.out, /TEST: {6}PASS/);
  renameSync(join(rig, "node_modules"), join(rig, "dependency-cache"));
  symlinkSync(join(rig, "dependency-cache"), join(rig, "node_modules"));
  const symlinkSource = gate(rig, env); assert.equal(symlinkSource.code, 0, symlinkSource.out);
  const failed = gate(rig, { ...env, FAIL_COPY: "1" }); assert.notEqual(failed.code, 0); assert.match(failed.out, /dependency staging failed/);
});
