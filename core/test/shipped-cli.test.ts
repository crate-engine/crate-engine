import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { heavyDeps, installHeavyDeps } from "../src/doctor.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-ship-"));
const REPO = join(import.meta.dirname, "..", "..");
const SHIM = join(REPO, "installer", "crate");

// ── P6-0: the shipped `crate` shim runs DIST-ONLY from the tier ─────────────

function runShim(home: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [SHIM, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("shim: missing tier refuses with the installer line", () => {
  const home = join(scratch, "home-empty");
  mkdirSync(home, { recursive: true });
  const r = runShim(home, ["--version"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /run the installer/);
});

test("shim: with a real tier clone, `crate --version` runs from dist (no tsx, no dev repo)", () => {
  const home = join(scratch, "home-tier");
  mkdirSync(join(home, ".crate"), { recursive: true });
  execFileSync("git", ["clone", "--quiet", REPO, join(home, ".crate", "engine")]);
  // Overlay the WORKING dist (this test exercises the current build through the
  // shim; the dist-sync guard is what pins committed dist == src) + link deps.
  execFileSync("rm", ["-rf", join(home, ".crate", "engine", "core", "dist")]);
  execFileSync("cp", ["-R", join(REPO, "core", "dist"), join(home, ".crate", "engine", "core", "dist")]);
  symlinkSync(join(REPO, "core", "node_modules"), join(home, ".crate", "engine", "core", "node_modules"));
  const r = runShim(home, ["--version"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^crate \(Crate Engine 2\.0\) — engine [0-9a-f]{7}/);
});

test("shim: missing core deps names the one-time npm install", () => {
  const home = join(scratch, "home-nodeps");
  mkdirSync(join(home, ".crate", "engine", "core", "dist"), { recursive: true });
  writeFileSync(join(home, ".crate", "engine", "core", "dist", "cli.js"), "// present\n");
  const r = runShim(home, ["--version"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /npm install/);
});

// ── P6-1: heavy seat-deps at first attach (G2) ───────────────────────────────

function makeHeavyFixture(tag: string): { proj: string; marker: string } {
  const brain = join(scratch, `brain-${tag}`);
  mkdirSync(join(brain, "bin"), { recursive: true });
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  writeFileSync(join(brain, "config", "tester.md"), "# qa binder\n");
  const marker = join(scratch, `heavy-${tag}.marker`);
  writeFileSync(
    join(brain, "config", "loadouts", "tester.yaml"),
    [
      "seat: tester",
      "binder: config/tester.md",
      "cli_deps:",
      "  - name: fake-browser-bundle",
      `    check: test -f ${marker}`,
      `    install: touch ${marker}`,
      "    heavy: true",
      "  - name: git",
      "    check: command -v git",
      "policy:",
      "  tools: read,bash",
      "  default_model: openai-codex/gpt-5.5",
      "  sandbox: standard",
    ].join("\n"),
  );
  const proj = join(scratch, `heavy-proj-${tag}`);
  mkdirSync(join(proj, ".agents"), { recursive: true });
  symlinkSync(join(brain, "bin"), join(proj, ".agents", "bin"));
  writeFileSync(join(proj, ".agents", "rig.conf"), 'PROJECT="heavy-proj"\n');
  return { proj, marker };
}

test("heavy deps: failing heavy check is disclosed; light deps never are", async () => {
  const { proj } = makeHeavyFixture("a");
  const deps = await heavyDeps(proj);
  assert.equal(deps.length, 1);
  assert.equal(deps[0]!.name, "fake-browser-bundle");
  assert.equal(deps[0]!.seat, "tester");
});

test("heavy deps: install runs the declared command and re-checks green; then nothing left to offer", async () => {
  const { proj, marker } = makeHeavyFixture("b");
  const deps = await heavyDeps(proj);
  const results = await installHeavyDeps(deps);
  assert.deepEqual(results.map((r) => [r.name, r.ok]), [["fake-browser-bundle", true]]);
  assert.ok(existsSync(marker));
  assert.equal((await heavyDeps(proj)).length, 0); // satisfied → no longer offered
});
