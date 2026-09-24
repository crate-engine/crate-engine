// Workspace Controls S3/S4 — the native shells (PDR dev/pdr/workspace-controls.md).
// Source-level pins (the CE-148 pattern): both shells carry the Workspaces menu
// with the agreed actions, confirm before closing agent sessions, gate Restart
// on the busy signal, and say what keeps running on quit. The Linux menus were
// also rendered headless against a live engine (xvfb) during the build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const apps = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps");
const mac = readFileSync(join(apps, "mac-shell", "main.swift"), "utf8");
const py = readFileSync(join(apps, "linux-shell", "main.py"), "utf8");

test("both shells: a top-level Workspaces menu with Open · Stop · Resume · Resume Fresh · Archive · Restore · Stop All", () => {
  for (const [src, label] of [[mac, "mac"], [py, "linux"]] as const) {
    for (const t of ['"Open"', '"Stop…"', '"Resume"', '"Resume Fresh…"', '"Archive…"', '"Restore"']) assert.ok(src.includes(t), `${label}: ${t}`);
    assert.ok(src.includes("Stop All on"), `${label}: Stop All per computer`);
    assert.ok(src.includes("Archived ("), `${label}: an Archived section`);
    assert.ok(src.includes("/api/fleet/workspace"), `${label}: actions go through the hub's one route (any computer)`);
  }
});

test("both shells: stopping agents always asks, counts the sessions, and warns on a mid-task seat", () => {
  for (const [src, label] of [[mac, "mac"], [py, "linux"]] as const) {
    assert.ok(src.includes("agent session"), `${label}: says how many agent sessions close`);
    assert.ok(src.includes("in the middle of a task"), `${label}: warns about a mid-task seat`);
    assert.ok(src.includes("Stop Workspace") && src.includes("Archive Workspace"), `${label}: plain confirm buttons`);
  }
});

test("both shells: Computers is about machines — Up to date / Restart to finish, gated on busy teams", () => {
  for (const [src, label] of [[mac, "mac"], [py, "linux"]] as const) {
    assert.ok(src.includes("Restart to finish update…") && src.includes("Up to date"), `${label}: plain update status`);
    assert.ok(src.includes("mid-task") && src.includes("Try again when they finish"), `${label}: never restarts over a busy team — and names it`);
    assert.ok(src.includes("see Workspaces"), `${label}: project rows moved to the Workspaces menu`);
  }
});

test("both shells: quitting says what keeps running — once, with Stop Them Too and don't-show-again", () => {
  assert.ok(mac.includes("func applicationShouldTerminate(") && mac.includes("keep") && mac.includes("running in the background"), "mac: the quit note");
  assert.ok(mac.includes('"Stop Them Too"') && mac.includes("showsSuppressionButton"), "mac: stop-too + suppression");
  assert.ok(py.includes("def confirm_quit(") && py.includes('"Stop Them Too"') && py.includes("Don't show this again"), "linux: the same note");
  assert.ok(py.includes('connect("delete-event"'), "linux: closing the window asks too");
});
