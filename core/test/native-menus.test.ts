// Backlog 11 (Adam, 2026-08-12; shipped 2026-08-14): the cockpit's static
// panels live in the OS chrome. The mac shell grows a real View menu
// (Team/Context/Health, ⌘1/⌘2/⌘3) that opens panels through the page's
// crateOpenPanel bridge; the page retires those three navbtns in the shell
// (one home per control). Preview/Servers keep their in-page buttons —
// their state (pending dot, chip) lives in the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });
const shell = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "mac-shell", "main.swift"),
  "utf8",
);

test("the page exposes the panel bridge, and the shell retires exactly the three static navbtns", () => {
  assert.ok(html.includes("window.crateOpenPanel="), "the bridge exists");
  const fn = html.slice(html.indexOf("window.crateOpenPanel="));
  for (const id of ["teambtn", "ctxbtn", "healthbtn"]) {
    assert.ok(fn.includes(id), `the bridge routes ${id}`);
  }
  assert.ok(html.includes('if(window.crateShell){["teambtn","ctxbtn","healthbtn"]'), "ONLY the three static buttons retire in the shell");
  assert.ok(!/crateShell.*svbtn/.test(html) && !/crateShell.*pvbtn/.test(html), "Preview/Servers keep their in-page buttons — stateful chrome stays in the page");
});

test("the shell's View menu: three items, cmd-1/2/3, validated against cockpitReady", () => {
  assert.ok(shell.includes('NSMenu(title: "View")'), "a real View menu exists");
  for (const [name, key] of [["Team", "1"], ["Context", "2"], ["Health", "3"]] as const) {
    assert.ok(shell.includes(`NSMenuItem(title: "${name}",`), `${name} is a menu item`);
    assert.ok(shell.includes(`keyEquivalent: "${key}"`), `${name} rides cmd-${key}`);
  }
  assert.ok(shell.includes("NSMenuItemValidation"), "items validate — no dead clicks");
  assert.ok(shell.includes("d.cockpitReady"), "validation gates on the cockpit page being loaded");
  assert.ok(shell.includes("window.crateOpenPanel && window.crateOpenPanel"), "menu actions call the page bridge, guarded for old pages");
});

test("cockpitReady flips only on the MAIN webview finishing a loopback load — boot/error screens keep the menu disabled", () => {
  const fn = shell.slice(shell.indexOf("func webView(_ webView: WKWebView, didFinish"));
  assert.ok(fn.includes("webView == self.webView"), "satellite loads never flip the flag");
  assert.ok(fn.includes('"127.0.0.1"') && fn.includes('"localhost"'), "only the engine's loopback door counts");
});

// ── the updater (Adam, 2026-08-15; FLEET-WIDE + moved into the app menu at
// Adam's ask, 2026-08-18): one click updates the hub + EVERY remembered
// host; the old top-level Update menu retired — one home per control. ──
test("Update Crate Engine lives in the APP menu on both shells (cmd/ctrl+U), fleet-wide via the hub; the Update menu is retired", () => {
  const pyShell = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "linux-shell", "main.py"), "utf8");
  // the page keeps its per-engine routine for the Health panel's button
  assert.ok(html.includes("window.crateUpdate=") && html.includes("async function runEngineUpdate"), "the Health panel's per-engine door survives");
  assert.ok(html.includes('if(r.before===r.after){await uiNotice("Already current'), "an already-current update says so plainly");
  // mac: app menu item, fleet-wide, off-thread, honest per-host report
  assert.ok(!shell.includes('NSMenu(title: "Update")'), "mac: the top-level Update menu is gone");
  assert.ok(shell.includes('"Update Crate Engine…"') && shell.includes('keyEquivalent: "u"'), "mac: the updater sits in the app menu, cmd-U kept");
  const macUpd = shell.slice(shell.indexOf("@objc func updateFleet"));
  assert.ok(macUpd.includes("/api/fleet/update"), "mac: it updates the WHOLE fleet through the hub");
  assert.ok(macUpd.includes("timeout: 900"), "mac: npm-install-per-host honesty — minutes, off-thread");
  assert.ok(macUpd.includes("next relaunch"), "mac: the report says how the update finishes");
  // linux: same shape
  assert.ok(!pyShell.includes('label="Update"'), "linux: the top-level Update menu is gone");
  assert.ok(pyShell.includes("Update Crate Engine…") && pyShell.includes("on_fleet_update"), "linux: app-menu updater");
  assert.ok(pyShell.includes("/api/fleet/update") && pyShell.includes("timeout=900"), "linux: fleet-wide, off-thread");
});

test("the installer ends with a NATIVE APP on both platforms — plain-words fallbacks, never sudo", () => {
  const inst = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "installer", "get-crate.sh"), "utf8");
  assert.ok(inst.includes("apps/mac-shell/build.sh") && inst.includes("xcode-select --install"), "mac: builds the app when swiftc exists, names the one-time step when not");
  assert.ok(inst.includes("apps/linux-shell/install.sh") && inst.includes("gir1.2-webkit2-4.1"), "linux: installs the GTK app when deps exist, names them when not");
  assert.ok(inst.includes('open -a "Crate Engine"') && inst.includes("gtk-launch crate-engine"), "the finale launches the NATIVE app, browser window only as fallback");
  assert.ok(!/^sudo /m.test(inst), "the installer suggests sudo (inside hint strings), never runs it");
});
