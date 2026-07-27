// PHASE-8 T6 — the headless wall: resolveHeadlessWall wraps a runner turn in
// the seat's declared wall (Seatbelt on macOS, bwrap on Linux) and enforces
// the walled-required refusal law (claude/codex NEVER run headless unwalled —
// the P5-0a/P8 walling law carried onto the runner path).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { resolveHeadlessWall } from "../src/wall.js";
import { buildHeadlessInvocation } from "../src/turn.js";

const BRAIN = resolve(import.meta.dirname, "..", "..");

/** A scratch rig wired like the real ones: .agents/config → the brain's config. */
function makeRig(brainRoot: string = BRAIN): { project: string; home: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "walltest-"));
  const project = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(join(project, ".agents", "state"), { recursive: true });
  mkdirSync(home, { recursive: true });
  symlinkSync(join(brainRoot, "config"), join(project, ".agents", "config"));
  return { project, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A minimal fake brain whose one loadout declares sandbox: none. */
function makeNoneBrain(seat: string, agent: string): { brainRoot: string; cleanup: () => void } {
  const brainRoot = mkdtempSync(join(tmpdir(), "walltest-brain-"));
  mkdirSync(join(brainRoot, "config", "loadouts"), { recursive: true });
  writeFileSync(join(brainRoot, "config", `${seat}.md`), "binder\n");
  writeFileSync(
    join(brainRoot, "config", "loadouts", `${seat}.yaml`),
    [
      `seat: ${seat}`,
      `agent: ${agent}`,
      `binder: config/${seat}.md`,
      "policy:",
      '  tools: "read,bash"',
      "  default_model: x/y",
      "  sandbox: none",
    ].join("\n") + "\n",
  );
  return { brainRoot, cleanup: () => rmSync(brainRoot, { recursive: true, force: true }) };
}

test("walled-required: codex with NO loadout (no .agents/config) REFUSES", () => {
  const root = mkdtempSync(join(tmpdir(), "walltest-bare-"));
  const project = join(root, "proj");
  mkdirSync(join(project, ".agents", "state"), { recursive: true });
  try {
    assert.throws(
      () => resolveHeadlessWall(project, "coder", "codex", { platform: "darwin", home: root }),
      /REFUSING.*codex.*wall/is,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("walled-required: claude on a sandbox:none loadout REFUSES", () => {
  const brain = makeNoneBrain("coder", "claude-code");
  const rig = makeRig(brain.brainRoot);
  try {
    assert.throws(
      () => resolveHeadlessWall(rig.project, "coder", "claude", { platform: "darwin", home: rig.home }),
      /REFUSING.*sandbox: none/is,
    );
  } finally {
    rig.cleanup();
    brain.cleanup();
  }
});

test("pi with no loadout runs unwalled (today's scratch-rig behavior)", () => {
  const root = mkdtempSync(join(tmpdir(), "walltest-bare-"));
  const project = join(root, "proj");
  mkdirSync(join(project, ".agents", "state"), { recursive: true });
  try {
    assert.equal(resolveHeadlessWall(project, "reviewer", "pi", { platform: "darwin", home: root }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pi on the real brain's reviewer loadout gets the readonly wall (cmux parity)", () => {
  const rig = makeRig();
  try {
    const wall = resolveHeadlessWall(rig.project, "reviewer", "pi", { platform: "darwin", home: rig.home })!;
    assert.equal(wall.backend, "seatbelt");
    assert.equal(wall.sandbox, "readonly");
    assert.equal(wall.argvPrefix[0], "sandbox-exec");
  } finally {
    rig.cleanup();
  }
});

test("codex on the real brain renders a wall with codex state doors; linux → bwrap", () => {
  const rig = makeRig();
  try {
    const mac = resolveHeadlessWall(rig.project, "coder", "codex", { platform: "darwin", home: rig.home })!;
    assert.equal(mac.backend, "seatbelt");
    const linux = resolveHeadlessWall(rig.project, "coder", "codex", {
      platform: "linux",
      home: rig.home,
      bwrapBin: "/usr/bin/bwrap",
    })!;
    assert.equal(linux.backend, "bwrap");
    const s = linux.argvPrefix.join(" ");
    assert.ok(s.includes(`${rig.home}/.codex`), "the harness's own state door rides the wall");
    assert.ok(s.includes("--ro-bind / /"));
  } finally {
    rig.cleanup();
  }
});

test("walled-required on linux WITHOUT bwrap refuses with the install line", () => {
  const rig = makeRig();
  try {
    assert.throws(
      () => resolveHeadlessWall(rig.project, "coder", "codex", { platform: "linux", home: rig.home, bwrapBin: undefined }),
      /bubblewrap/,
    );
  } finally {
    rig.cleanup();
  }
});

test("walled claude invocation carries the bypass flag INSIDE the wall, before the prompt", () => {
  const inv = buildHeadlessInvocation("claude", { prompt: "do the thing", walled: true });
  const i = inv.argv.indexOf("--permission-mode");
  assert.ok(i !== -1, "walled claude gets bypassPermissions (unattended turns must not stall)");
  assert.equal(inv.argv[i + 1], "bypassPermissions");
  assert.ok(i < inv.argv.indexOf("do the thing"), "flags come before the positional prompt");
  const unwalled = buildHeadlessInvocation("claude", { prompt: "x" });
  assert.ok(!unwalled.argv.includes("--permission-mode"), "NO bypass without a wall (P4-12)");
});

test("codex bypass flag is GATED on walled too (defense-in-depth parity with claude)", () => {
  const walled = buildHeadlessInvocation("codex", { prompt: "build", walled: true });
  assert.ok(walled.argv.includes("--dangerously-bypass-approvals-and-sandbox"), "walled codex runs full-auto inside the wall");
  assert.ok(walled.argv.includes("--json"));
  const unwalled = buildHeadlessInvocation("codex", { prompt: "build" });
  assert.ok(!unwalled.argv.includes("--dangerously-bypass-approvals-and-sandbox"), "NO bypass without a wall — an unwalled codex would merely prompt, not run uncontained");
});

test("normalizeAgent folds claude-code → claude so the refusal law fires", async () => {
  const { normalizeAgent } = await import("../src/wall.js");
  assert.equal(normalizeAgent("claude-code"), "claude");
  assert.equal(normalizeAgent("codex"), "codex");
  assert.equal(normalizeAgent("pi"), "pi");
  // a loadout-less claude-code seat REFUSES (not silently unwalled) via the normalized key
  const root = mkdtempSync(join(tmpdir(), "walltest-bare-"));
  const project = join(root, "proj");
  mkdirSync(join(project, ".agents", "state"), { recursive: true });
  try {
    assert.throws(
      () => resolveHeadlessWall(project, "coder", "claude-code", { platform: "linux", home: root, bwrapBin: "/usr/bin/bwrap" }),
      /REFUSING.*wall/is,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
