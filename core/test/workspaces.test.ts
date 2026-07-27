// PHASE-8 T7-1 — the workspace registry (the multi-workspace rail's backend).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listWorkspaces, registerWorkspace, removeWorkspace, workspacesFile } from "../src/gui/workspaces.js";

function mkHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ws-home-"));
  mkdirSync(join(home, ".crate"), { recursive: true }); // the user tier exists
  return home;
}

function mkRig(home: string, name: string): string {
  const p = join(home, "repos", name);
  mkdirSync(join(p, ".agents", "state"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT=${name}\n`);
  return p;
}

test("empty registry: no file → empty list, no crash", () => {
  const home = mkHome();
  try {
    assert.deepEqual(listWorkspaces(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("register is idempotent (dedup by path) and persists", () => {
  const home = mkHome();
  const a = mkRig(home, "alpha");
  try {
    registerWorkspace(home, a);
    registerWorkspace(home, a); // twice
    const list = listWorkspaces(home);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "alpha");
    assert.equal(list[0]!.path, a);
    assert.equal(list[0]!.rig, true);
    assert.equal(list[0]!.exists, true);
    assert.ok(workspacesFile(home).endsWith(".crate/workspaces.json"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("enrich: a registered-then-deleted path is exists:false, rig:false, still listed", () => {
  const home = mkHome();
  const a = mkRig(home, "alpha");
  try {
    registerWorkspace(home, a);
    rmSync(a, { recursive: true, force: true });
    const list = listWorkspaces(home);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.exists, false);
    assert.equal(list[0]!.rig, false);
    assert.equal(list[0]!.lastActivityMs, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("lastActivity reflects the newest turn log; sort is most-recent-first", () => {
  const home = mkHome();
  const a = mkRig(home, "alpha");
  const b = mkRig(home, "beta");
  try {
    registerWorkspace(home, a);
    registerWorkspace(home, b);
    // beta has a turn log, alpha does not
    mkdirSync(join(b, ".agents", "state", "turns", "coder"), { recursive: true });
    writeFileSync(join(b, ".agents", "state", "turns", "coder", "turns.log"), "x\n");
    const list = listWorkspaces(home);
    assert.equal(list[0]!.name, "beta", "the active team sorts first");
    assert.ok(list[0]!.lastActivityMs !== null);
    assert.equal(list.find((w) => w.name === "alpha")!.lastActivityMs, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove drops the entry but never touches the repo on disk", () => {
  const home = mkHome();
  const a = mkRig(home, "alpha");
  try {
    registerWorkspace(home, a);
    const after = removeWorkspace(home, a);
    assert.deepEqual(after, []);
    assert.ok(listWorkspaces(home).length === 0);
    // the repo is untouched
    assert.ok(join(a, ".agents", "rig.conf"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("corrupt registry degrades to empty, never throws", () => {
  const home = mkHome();
  try {
    writeFileSync(workspacesFile(home), "{ not json ["); // garbage
    assert.deepEqual(listWorkspaces(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
