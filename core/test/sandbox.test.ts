import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { expandDoor, renderProfile, specFromLoadout, writeProfile, SandboxError } from "../src/sandbox.js";

// Golden tests run against the REAL shipped templates — they are the artifact
// under test (a template edit that breaks the wall shape should fail here).
const BRAIN = resolve(import.meta.dirname, "..", "..");
const paths = { brainRoot: BRAIN, projectRoot: "/Users/example/Projects/selftest", home: "/Users/example" };

test("readonly: project write-wall with the .agents/state door, no {{tokens}} left", () => {
  const text = renderProfile({ seat: "reviewer", sandbox: "readonly", doors: [] }, paths)!;
  assert.match(text, /\(deny file-write\*\)/);
  assert.ok(text.includes('(subpath "/Users/example/Projects/selftest/.agents/state")'));
  assert.ok(!text.includes('(subpath "/Users/example/Projects/selftest")\n'), "readonly must NOT open the whole project");
  assert.ok(text.includes('(subpath "/Users/example/.pi")'));
  assert.ok(!text.includes("{{"), "no unsubstituted placeholders");
});

test("standard: whole-project door + scratch + harness state, no doors block when doorless", () => {
  const text = renderProfile({ seat: "tester", sandbox: "standard", doors: [] }, paths)!;
  assert.ok(text.includes('(subpath "/Users/example/Projects/selftest")'));
  assert.ok(text.includes('(subpath "/private/tmp")'));
  assert.ok(!text.includes("sandbox_doors)"), "no doors block rendered for an empty doors list");
  assert.ok(!text.includes("{{"), "no unsubstituted placeholders");
});

test("doors expand: ~, project-relative, absolute", () => {
  const text = renderProfile(
    { seat: "coder", sandbox: "standard", doors: ["~/.npm", ".worktrees", "/opt/cache"] },
    paths,
  )!;
  assert.ok(text.includes('(subpath "/Users/example/.npm")'));
  assert.ok(text.includes('(subpath "/Users/example/Projects/selftest/.worktrees")'));
  assert.ok(text.includes('(subpath "/opt/cache")'));
  const wall = text.indexOf("(deny file-write*)");
  const door = text.indexOf('(subpath "/Users/example/.npm")');
  assert.ok(door > wall, "doors must come AFTER the wall (later rules win)");
});

test("regex door: {{PARENT}} substituted regex-escaped, subpath doors unchanged", async () => {
  const { renderDoor } = await import("../src/sandbox.js");
  assert.equal(
    renderDoor("regex:^{{PARENT}}/\\.nmgate-wt-", paths),
    '  (regex #"^/Users/example/Projects/\\.nmgate-wt-")',
  );
  const text = renderProfile(
    { seat: "coder", sandbox: "standard", doors: ["~/.npm", "regex:^{{PARENT}}/\\.nmgate-wt-"] },
    paths,
  )!;
  assert.ok(text.includes('(regex #"^/Users/example/Projects/\\.nmgate-wt-")'));
  assert.ok(text.includes('(subpath "/Users/example/.npm")'));
});

test("expandDoor forms", () => {
  assert.equal(expandDoor("~", paths), "/Users/example");
  assert.equal(expandDoor("~/.claude", paths), "/Users/example/.claude");
  assert.equal(expandDoor(".agents/state/bh", paths), "/Users/example/Projects/selftest/.agents/state/bh");
  assert.equal(expandDoor("/private/etc", paths), "/private/etc");
});

test("sandbox none renders nothing; writeProfile mirrors it", () => {
  const dir = mkdtempSync(join(tmpdir(), "sbtest-"));
  try {
    assert.equal(renderProfile({ seat: "x", sandbox: "none", doors: [] }, paths), undefined);
    assert.equal(writeProfile({ seat: "x", sandbox: "none", doors: [] }, paths, dir), undefined);
    const file = writeProfile({ seat: "reviewer", sandbox: "readonly", doors: [] }, paths, dir)!;
    assert.equal(file, join(dir, "reviewer.sb"));
    assert.match(readFileSync(file, "utf8"), /\(version 1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing template and missing marker fail loud", () => {
  assert.throws(
    () => renderProfile({ seat: "x", sandbox: "readonly", doors: [] }, { ...paths, brainRoot: "/nonexistent" }),
    SandboxError,
  );
});

test("specFromLoadout narrows a manifest", () => {
  const spec = specFromLoadout({ seat: "tester", policy: { sandbox: "standard", sandbox_doors: ["~/.npm"] } });
  assert.deepEqual(spec, { seat: "tester", sandbox: "standard", doors: ["~/.npm"] });
});

test("all five shipped manifests render against the real templates", async () => {
  const { loadLoadout } = await import("../src/manifest.js");
  for (const seat of ["reviewer", "tester", "designer", "orchestrator", "coder"] as const) {
    const loadout = loadLoadout(BRAIN, seat);
    const text = renderProfile(specFromLoadout(loadout), paths);
    assert.ok(text && text.includes("(deny file-write*)"), `${seat} renders a walled profile`);
  }
});

test("agent field: coder is claude-code, the pi seats default to pi", async () => {
  const { loadLoadout } = await import("../src/manifest.js");
  assert.equal(loadLoadout(BRAIN, "coder").agent, "claude-code");
  assert.equal(loadLoadout(BRAIN, "reviewer").agent, "pi");
});

// ---- PHASE-8 T6: the bwrap backend (Linux walls behind the same seam) ----

/** A real (writable) fixture — bwrap render materializes missing dir-doors. */
function bwrapFixture(): { home: string; project: string; p: typeof paths; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "sbtest-home-"));
  const project = join(home, "Projects", "selftest");
  return {
    home,
    project,
    p: { brainRoot: BRAIN, projectRoot: project, home },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

test("bwrap readonly: ro root + state door, project NOT writable", async () => {
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  const f = bwrapFixture();
  try {
    const r = renderBwrapArgs({ seat: "reviewer", sandbox: "readonly", doors: [] }, f.p)!;
    const s = r.args.join(" ");
    assert.ok(s.startsWith("--ro-bind / /"), "read-everything base comes first");
    assert.ok(s.includes(`--bind ${f.project}/.agents/state ${f.project}/.agents/state`));
    assert.ok(!s.includes(`--bind ${f.project} ${f.project}`), "readonly must NOT open the whole project");
    assert.ok(s.includes("--die-with-parent"));
    assert.ok(s.includes("--dev /dev"), "minimal /dev (null/tty) like the Seatbelt tty/null allowance");
    assert.ok(s.includes("--unshare-pid"), "sandbox isolated from the host process table (cannot signal the supervisor)");
    assert.ok(s.includes("--unshare-ipc"), "sandbox isolated from host IPC");
    assert.ok(!s.includes("--unshare-net"), "network stays shared (network: true seats need it)");
    assert.ok(!s.includes("/run/user"), "no session D-Bus bind (StartTransientUnit escape surface)");
    assert.ok(!s.includes("/var/tmp"), "no /var/tmp bind (Seatbelt parity — only /tmp)");
    assert.ok(s.includes("/tmp"), "scratch stays writable");
    assert.deepEqual(r.skippedDoors, []);
    assert.deepEqual(r.absentDoors, []);
  } finally {
    f.cleanup();
  }
});

test("bwrap standard: whole project writable, doors after the base", async () => {
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  const f = bwrapFixture();
  const door = join(f.home, "cache");
  try {
    const r = renderBwrapArgs({ seat: "tester", sandbox: "standard", doors: [door] }, f.p)!;
    const s = r.args.join(" ");
    assert.ok(s.includes(`--bind ${f.project} ${f.project}`));
    assert.ok(r.args.indexOf(door) > r.args.indexOf("/"), "doors bind AFTER the ro base (later binds win)");
  } finally {
    f.cleanup();
  }
});

test("bwrap: regex doors are un-expressible as bind mounts — skipped and REPORTED", async () => {
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  const f = bwrapFixture();
  const door = join(f.home, "cache");
  try {
    const r = renderBwrapArgs(
      { seat: "coder", sandbox: "standard", doors: [door, "regex:^{{PARENT}}/\\.nmgate-wt-"] },
      f.p,
    )!;
    assert.deepEqual(r.skippedDoors, ["regex:^{{PARENT}}/\\.nmgate-wt-"]);
    assert.ok(r.args.includes(door), "plain doors still bind");
    assert.ok(!r.args.join(" ").includes("nmgate"), "the regex door must not leak into argv");
  } finally {
    f.cleanup();
  }
});

test("bwrap: sandbox none renders nothing", async () => {
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  assert.equal(renderBwrapArgs({ seat: "x", sandbox: "none", doors: [] }, paths), undefined);
});

test("bwrap: missing dir-door is created; missing file-door binds try-only + is REPORTED absent", async () => {
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  const home = mkdtempSync(join(tmpdir(), "sbtest-home-"));
  const project = join(home, "proj");
  try {
    const p = { brainRoot: BRAIN, projectRoot: project, home };
    const r = renderBwrapArgs(
      { seat: "coder", sandbox: "standard", doors: ["~/.npm", "~/.claude.json"] },
      p,
    )!;
    const s = r.args.join(" ");
    assert.ok(existsSync(join(home, ".npm")), "dir-door materialized (bind mounts need a real source)");
    assert.ok(s.includes(`--bind ${home}/.npm ${home}/.npm`));
    assert.ok(s.includes(`--bind-try ${home}/.claude.json`), "missing file-door must not hard-fail bwrap");
    assert.deepEqual(r.absentDoors, [`${home}/.claude.json`], "absent file-door reported, not silently dropped");
    // An EXISTING file-door is a plain bind and NOT reported absent.
    writeFileSync(join(home, ".claude.json"), "{}");
    const r2 = renderBwrapArgs({ seat: "coder", sandbox: "standard", doors: ["~/.claude.json"] }, p)!;
    assert.ok(r2.args.join(" ").includes(`--bind ${home}/.claude.json ${home}/.claude.json`));
    assert.deepEqual(r2.absentDoors, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("all five shipped manifests render bwrap walls with NO skipped doors (T7-0: nm-gate door is bindable)", async () => {
  const { loadLoadout } = await import("../src/manifest.js");
  const { renderBwrapArgs } = await import("../src/sandbox.js");
  const home = mkdtempSync(join(tmpdir(), "sbtest-home-"));
  try {
    const p = { brainRoot: BRAIN, projectRoot: join(home, "work", "proj"), home };
    for (const seat of ["reviewer", "tester", "designer", "orchestrator", "coder"] as const) {
      const r = renderBwrapArgs(specFromLoadout(loadLoadout(BRAIN, seat)), p);
      assert.ok(r && r.args[0] === "--ro-bind", `${seat} renders a bwrap wall`);
      assert.deepEqual(r.skippedDoors, [], `${seat} has no un-expressible doors`);
    }
    // The coder's nm-gate sibling dir is a real bind mount, materialized.
    const coder = renderBwrapArgs(specFromLoadout(loadLoadout(BRAIN, "coder")), p)!;
    const nmgate = join(home, "work", ".nmgate-wt");
    assert.ok(coder.args.join(" ").includes(`--bind ${nmgate} ${nmgate}`), "nm-gate worktree parent binds");
    assert.ok(existsSync(nmgate), "the bindable dir is created (mounts need a real source)");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("renderWallPlan: platform dispatch — seatbelt on darwin, bwrap on linux, loud elsewhere", async () => {
  const { renderWallPlan, SandboxError: SBE } = await import("../src/sandbox.js");
  const dir = mkdtempSync(join(tmpdir(), "sbtest-plan-"));
  const home = mkdtempSync(join(tmpdir(), "sbtest-home-"));
  try {
    const p = { brainRoot: BRAIN, projectRoot: join(home, "proj"), home };
    const spec = { seat: "reviewer", sandbox: "readonly" as const, doors: [] };
    const mac = renderWallPlan(spec, p, dir, { platform: "darwin" })!;
    assert.equal(mac.backend, "seatbelt");
    assert.equal(mac.argvPrefix[0], "sandbox-exec");
    assert.equal(mac.argvPrefix[1], "-f");
    const linux = renderWallPlan(spec, p, dir, { platform: "linux", bwrapBin: "/usr/bin/bwrap" })!;
    assert.equal(linux.backend, "bwrap");
    assert.equal(linux.argvPrefix[0], "/usr/bin/bwrap");
    assert.ok(linux.argvPrefix.includes("--ro-bind"));
    assert.throws(() => renderWallPlan(spec, p, dir, { platform: "linux", bwrapBin: undefined }), /bubblewrap/);
    assert.throws(() => renderWallPlan(spec, p, dir, { platform: "win32" }), SBE);
    assert.equal(renderWallPlan({ ...spec, sandbox: "none" }, p, dir, { platform: "linux", bwrapBin: "/usr/bin/bwrap" }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("stateDoorsFor: claude-code gets its state doors, pi rides the template", async () => {
  const { stateDoorsFor } = await import("../src/sandbox.js");
  assert.deepEqual(stateDoorsFor("claude-code"), ["~/.claude", "~/.claude.json", "~/.claude.json.backup"]);
  assert.deepEqual(stateDoorsFor("pi"), []);
  // GOLDEN: the coder wall = npm door + claude state doors, after the wall
  const text = renderProfile(
    { seat: "coder", sandbox: "standard", doors: ["~/.npm", ...stateDoorsFor("claude-code")] },
    paths,
  )!;
  for (const p of ["/Users/example/.npm", "/Users/example/.claude", "/Users/example/.claude.json"]) {
    assert.ok(text.includes(`(subpath "${p}")`), `door ${p}`);
  }
});

// ── CE-129: pre-seeded folder trust (attach IS the trust decision) ──────────
// A walled claude cannot persist its own trust answer: its save shape is
// tmp+rename over ~/.claude.json (strace-proven), unexpressible through a
// single-file bind — so the engine seeds the key claude's dialog would write.
import { preseedClaudeProjectTrust } from "../src/sandbox.js";

function mkHome(cfg?: unknown): string {
  const home = mkdtempSync(join(tmpdir(), "crate2-trust-"));
  if (cfg !== undefined)
    writeFileSync(join(home, ".claude.json"), typeof cfg === "string" ? cfg : JSON.stringify(cfg, null, 2));
  return home;
}

test("seeds hasTrustDialogAccepted for the project, atomically, preserving the rest (CE-129)", () => {
  const home = mkHome({ numStartups: 42, projects: { "/other/rig": { hasTrustDialogAccepted: true, history: [1] } } });
  assert.equal(preseedClaudeProjectTrust(home, "/mnt/rigs/site"), true);
  const got = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
  assert.equal(got.projects["/mnt/rigs/site"].hasTrustDialogAccepted, true, "the new project is trusted");
  assert.equal(got.numStartups, 42, "unrelated config survives");
  assert.deepEqual(got.projects["/other/rig"], { hasTrustDialogAccepted: true, history: [1] }, "other projects untouched");
  assert.ok(!existsSync(join(home, ".claude.json.tmp-crate-" + process.pid)), "no tmp file left behind");
  rmSync(home, { recursive: true, force: true });
});

test("already-trusted project is a no-op — false, file untouched (CE-129)", () => {
  const home = mkHome({ projects: { "/mnt/rigs/site": { hasTrustDialogAccepted: true } } });
  const before = readFileSync(join(home, ".claude.json"), "utf8");
  assert.equal(preseedClaudeProjectTrust(home, "/mnt/rigs/site"), false);
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), before, "byte-identical");
  rmSync(home, { recursive: true, force: true });
});

test("absent config = not signed in — false, nothing created (CE-129)", () => {
  const home = mkHome();
  assert.equal(preseedClaudeProjectTrust(home, "/mnt/rigs/site"), false);
  assert.ok(!existsSync(join(home, ".claude.json")), "the engine must not conjure a config claude has not made");
  rmSync(home, { recursive: true, force: true });
});

test("corrupt config is left exactly as found — never block a spawn, never 'repair' (CE-129)", () => {
  const home = mkHome("{not json at all");
  assert.equal(preseedClaudeProjectTrust(home, "/mnt/rigs/site"), false);
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), "{not json at all");
  rmSync(home, { recursive: true, force: true });
});

test("a project entry claude already started (no trust key yet) gains ONLY the key (CE-129)", () => {
  const home = mkHome({ projects: { "/mnt/rigs/site": { projectOnboardingSeenCount: 3 } } });
  assert.equal(preseedClaudeProjectTrust(home, "/mnt/rigs/site"), true);
  const got = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
  assert.deepEqual(got.projects["/mnt/rigs/site"], { projectOnboardingSeenCount: 3, hasTrustDialogAccepted: true });
  rmSync(home, { recursive: true, force: true });
});
