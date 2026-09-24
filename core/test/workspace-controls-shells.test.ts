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

// Adam's docket test (2026-09-24): Stop from the menu worked, but (1) the open
// drawer kept showing "5 agents" until reopened, (2) ⌃⌘S did nothing — the
// lazily built Workspaces menu had no item to match — and (3) a dialing host
// read "connecting — Connect".
test("the drawer stays live and the shells poke it after every action", () => {
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "gui", "teampage.ts"), "utf8");
  assert.match(page, /RAIL_TIMER=setInterval\(/, "the open drawer refreshes itself");
  assert.match(page, /window\.crateRefreshWorkspaces=/, "and exposes a refresh the shells can call");
  assert.ok(mac.includes("window.crateRefreshWorkspaces && window.crateRefreshWorkspaces()"), "mac pokes it after an action");
  assert.ok(py.includes("window.crateRefreshWorkspaces && window.crateRefreshWorkspaces()"), "linux pokes it after an action");
});

test("the drawer shortcut works before the menu was ever opened; no key event triggers a fleet fetch", () => {
  const ws = mac.slice(mac.indexOf("final class WorkspacesMenu"));
  assert.match(ws, /func menuHasKeyEquivalent[\s\S]*\[\.command, \.control\][\s\S]*openWorkspaces/, "mac: ⌃⌘S answered by the delegate");
  const fleet = mac.slice(mac.indexOf("final class FleetActions"), mac.indexOf("final class WorkspacesMenu"));
  assert.match(fleet, /func menuHasKeyEquivalent[^\n]*\{ false \}/, "mac: the Computers menu never populates on a keystroke");
  assert.ok(py.includes("accel.connect(Gdk.KEY_w"), "linux: Ctrl+W at window level");
});

test("a host mid-dial reads 'connecting…' — never a Connect button over a connect", () => {
  assert.ok(mac.includes('"   connecting…"') && py.includes('"   connecting…"'), "both shells");
  assert.ok(!/state == "connecting"[^\n]*Connect"/.test(mac), "mac never pairs connecting with Connect");
});

test("every menu open and the quit note read the fleet FRESH, never the cache", () => {
  assert.equal((mac.match(/hubFleetURL\("\/api\/fleet\?fresh=1"\)/g) ?? []).length, 4, "mac: Workspaces, Computers, quit note, post-update");
  assert.ok(!/hubFleetURL\("\/api\/fleet"\)/.test(mac), "mac: no cached fleet read left behind a menu");
  assert.ok(py.includes('self._hub_api("/api/fleet?fresh=1")') && !py.includes('self._hub_api("/api/fleet")'), "linux: the same");
});
