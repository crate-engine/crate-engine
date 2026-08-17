// CE-117 — project-owned ADDITIVE sandbox doors (Adam's ruling 2026-08-17).
// `.agents/config` is a symlink into the shared engine, so the only pre-CE-117
// way to give one project's coder a write door widened it for EVERY rig on the
// host. `.agents/doors.yaml` is the project-owned, repo-tracked, additive-only
// alternative: merged AFTER the loadout's doors, printed at every render.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadProjectDoors, projectDoorsPath, ManifestError } from "../src/manifest.js";
import { resolveHeadlessWall } from "../src/wall.js";

function mkProj(doorsYaml?: string): { project: string; cleanup: () => void } {
  const project = mkdtempSync(join(tmpdir(), "crate2-doors-"));
  mkdirSync(join(project, ".agents"), { recursive: true });
  if (doorsYaml !== undefined) writeFileSync(projectDoorsPath(project), doorsYaml);
  return { project, cleanup: () => rmSync(project, { recursive: true, force: true }) };
}

test("absent doors.yaml → no project doors, no error (CE-117)", () => {
  const p = mkProj();
  assert.deepEqual(loadProjectDoors(p.project, "coder"), []);
  p.cleanup();
});

test("doors merge `all` first, then the seat's own — other seats see only `all` (CE-117)", () => {
  const p = mkProj(["doors:", "  all:", "    - /srv/shared-cache", "  coder:", "    - ~/.config/some-tool"].join("\n"));
  assert.deepEqual(loadProjectDoors(p.project, "coder"), ["/srv/shared-cache", "~/.config/some-tool"]);
  assert.deepEqual(loadProjectDoors(p.project, "reviewer"), ["/srv/shared-cache"]);
  p.cleanup();
});

test("an unknown seat key is a LOUD error naming the valid seats (CE-117)", () => {
  const p = mkProj(["doors:", "  codr:", "    - /tmp/x"].join("\n"));
  assert.throws(() => loadProjectDoors(p.project, "coder"), (e: unknown) => {
    assert.ok(e instanceof ManifestError);
    assert.match((e as Error).message, /unknown seat "codr"/);
    assert.match((e as Error).message, /orchestrator, coder, reviewer/);
    return true;
  });
  p.cleanup();
});

test("invalid YAML and unknown top-level keys refuse loudly — never silently ignored (CE-117)", () => {
  const bad = mkProj("doors: [not: a: map");
  assert.throws(() => loadProjectDoors(bad.project, "coder"), ManifestError);
  bad.cleanup();
  const extra = mkProj(["doors: {}", "remove_doors:", "  - /etc"].join("\n"));
  assert.throws(() => loadProjectDoors(extra.project, "coder"), ManifestError,
    "a key that LOOKS like narrowing must not parse — additive-only is structural");
  extra.cleanup();
});

// ── through the REAL wall: the doors land in the rendered plan ──────────────
const BRAIN = resolve(import.meta.dirname, "..", "..");

test("project doors reach the rendered wall, appended after the loadout's own (CE-117)", () => {
  const root = mkdtempSync(join(tmpdir(), "crate2-doorwall-"));
  const project = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(join(project, ".agents", "state"), { recursive: true });
  mkdirSync(home, { recursive: true });
  symlinkSync(join(BRAIN, "config"), join(project, ".agents", "config"));
  writeFileSync(join(project, ".agents", "doors.yaml"),
    ["doors:", "  coder:", `    - ${join(root, "extra-door")}`].join("\n"));
  mkdirSync(join(root, "extra-door"), { recursive: true });
  const plan = resolveHeadlessWall(project, "coder", "claude", { home, platform: "darwin" })!;
  assert.ok(plan, "coder renders a wall");
  // Seatbelt: argvPrefix is [sandbox-exec, -f, <profile>, ...] — the rendered
  // profile file is the artifact the OS enforces, so assert against IT.
  const fIdx = plan.argvPrefix.indexOf("-f");
  assert.ok(fIdx >= 0 && plan.argvPrefix[fIdx + 1], "profile path present in argv");
  const profile = readFileSync(plan.argvPrefix[fIdx + 1]!, "utf8");
  assert.ok(profile.includes(join(root, "extra-door")), "the project door is in the rendered profile");
  rmSync(root, { recursive: true, force: true });
});
