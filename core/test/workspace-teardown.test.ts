// Workspace lifecycle (PDR dev/pdr/workspace-lifecycle.md) — the successor to
// the CE-014 pins. The old law was "ASK before stopping another workspace's
// team"; the new law is stronger: NOTHING aimed at one workspace can touch
// another, ever, so the question itself is retired. A workspace is Running or
// Parked BY RECORD (`desired` in workspaces.json, replacing the last-project
// global), focus is a view fact, and the 2026-08-16 morning — five empty
// panes read as a crash — can no longer happen by eviction: a seat-less
// workspace is Parked (calm invitations), and only started-then-died seats
// are distress (the downchip).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  desiredRunning,
  lastFocusedWorkspace,
  listWorkspaces,
  migrateLastProject,
  setWorkspaceDesired,
  setWorkspaceFocused,
} from "../src/gui/workspaces.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

function mkHome(): string {
  const home = mkdtempSync(join(tmpdir(), "wl-home-"));
  mkdirSync(join(home, ".crate"), { recursive: true });
  return home;
}

function mkRig(home: string, name: string): string {
  const p = join(home, "repos", name);
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT=${name}\n`);
  return p;
}

// ── the record: Running/Parked per workspace, focus separate ────────────────

test("desired state is per-workspace and defaults to parked — running is always an explicit record", () => {
  const home = mkHome();
  try {
    const a = mkRig(home, "alpha");
    const b = mkRig(home, "beta");
    setWorkspaceFocused(home, a); // focusing is NOT running
    assert.deepEqual(desiredRunning(home), [], "focus alone never marks running");
    setWorkspaceDesired(home, a, "running");
    setWorkspaceDesired(home, b, "running");
    assert.deepEqual(new Set(desiredRunning(home)), new Set([a, b]), "N workspaces run at once — that IS co-tenancy");
    setWorkspaceDesired(home, a, "parked"); // a scoped stop parks exactly one
    assert.deepEqual(desiredRunning(home), [b], "parking one never touches the other");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("focus is a VIEW fact: newest focusedAt wins the bare-open default; a vanished rig never does", () => {
  const home = mkHome();
  try {
    const a = mkRig(home, "alpha");
    const b = mkRig(home, "beta");
    setWorkspaceFocused(home, a);
    setWorkspaceFocused(home, b);
    assert.equal(lastFocusedWorkspace(home), b);
    rmSync(b, { recursive: true, force: true }); // rig gone — not a valid default
    assert.equal(lastFocusedWorkspace(home), a);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("migration: the last-project global folds into the record ONCE (desired=running — it was the auto-booted one), then retires", () => {
  const home = mkHome();
  try {
    const a = mkRig(home, "alpha");
    const f = join(home, ".crate", "last-project");
    writeFileSync(f, a + "\n");
    migrateLastProject(home);
    assert.ok(!existsSync(f), "the global file is retired");
    assert.deepEqual(desiredRunning(home), [a]);
    assert.equal(lastFocusedWorkspace(home), a);
    migrateLastProject(home); // idempotent — a missing file is a no-op
    assert.deepEqual(desiredRunning(home), [a]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a corrupt/legacy registry still reads (old entries get desired=parked), and records survive rewrite", () => {
  const home = mkHome();
  try {
    const a = mkRig(home, "alpha");
    // a pre-lifecycle registry: no desired/focusedAt fields
    writeFileSync(join(home, ".crate", "workspaces.json"), JSON.stringify([{ path: a, name: "alpha" }]) + "\n");
    assert.equal(listWorkspaces(home)[0]!.desired, "parked");
    setWorkspaceDesired(home, a, "running");
    assert.equal(listWorkspaces(home)[0]!.desired, "running");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the eviction is DEAD — pinned at the source ─────────────────────────────

test("crate open carries NO casualty prompt and NO eviction — the one door is /api/workspaces/open, scoped", () => {
  const cli = src("core/src/cli.ts");
  assert.ok(!cli.includes("this would STOP a live team"), "the prompt died with the hazard");
  assert.ok(!cli.includes("confirmTty("), "the yes/no is retired, not orphaned");
  assert.match(cli, /--stop-others is obsolete/, "a script still passing the flag gets a loud note, not an error");
  assert.match(cli, /api\/workspaces\/open/, "explicit open goes through the scoped door");
});

test("a BARE open boots NOTHING — what runs is what the record says (kills the auto-staff-the-wrong-workspace face)", () => {
  const cli = src("core/src/cli.ts");
  const openBlock = cli.slice(cli.indexOf("A BARE open boots NOTHING"), cli.indexOf('case "stop"'));
  assert.match(openBlock, /if \(project\) \{/, "the boot call is gated on an EXPLICIT project");
  assert.ok(!openBlock.includes("readLastProject"), "no fallback boot from a global");
});

test("crate stop <path> parks exactly one workspace; bare stop never rewrites any workspace's record", () => {
  const cli = src("core/src/cli.ts");
  const stopCase = cli.slice(cli.indexOf('case "stop"'), cli.indexOf('case "gui"'));
  assert.match(stopCase, /api\/team\/stop\?project=/, "scoped stop hits the per-workspace route");
  assert.match(stopCase, /recorded parked/, "with a server down, the RECORD still parks it");
  assert.match(stopCase, /every other workspace untouched/);
  const bare = stopCase.slice(stopCase.indexOf("const { appUrlPath }"));
  assert.ok(!bare.includes("setWorkspaceDesired"), "whole-engine shutdown leaves desired state alone — restart-resume reads it back");
});

test("the detachment costume is retired — no workspace is ever 'detached by a neighbour'", () => {
  assert.ok(!src("core/src/gui/server.ts").includes("detachedNote"), "the server makes no detachment claims");
  const page = src("core/src/gui/teampage.ts");
  assert.ok(!page.includes('id="detbar"'), "the banner element is gone");
  assert.ok(!page.includes("body.detached"), "and its display machinery with it");
  assert.match(page, /PARKED by record/, "the successor doctrine is stated where the banner lived");
});
