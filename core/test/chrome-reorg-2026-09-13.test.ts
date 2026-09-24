// Chrome reorg (Adam, 2026-09-13, after the third fresh install): the header
// loses its version tag + project label + Servers button; the menu bar gains
// File (the doors) and Servers (was Fleet) and the standard Window/Help pair;
// About shows the LIVE engine version; the Workspaces drawer is wider and
// resizable. Both shells carry the same structure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = teamPage({ project: "demo", seats: [] });
const swift = readFileSync(join(ROOT, "apps", "mac-shell", "main.swift"), "utf8");
const py = readFileSync(join(ROOT, "apps", "linux-shell", "main.py"), "utf8");
const build = readFileSync(join(ROOT, "apps", "mac-shell", "build.sh"), "utf8");

test("header: no version tag, no project label — the wordmark and the chips only", () => {
  assert.ok(!html.includes("CE-<b>2.2</b>") && !html.includes('class="ver"'), "the CE-2.2 tag is gone");
  assert.ok(!html.includes('id="projlabel"'), "the project label is gone");
  assert.match(html, /<title>Crate Engine — demo team<\/title>/, "…and the window title still names the rig");
  assert.ok(html.includes('id="upchip"') && html.includes('id="downchip"'), "the status chips stay");
});

test("the Workspaces drawer: 340px default, dragged by its edge, remembered", () => {
  assert.match(html, /\.rail\{[^}]*width:var\(--railw,340px\)/, "default width is the CSS token, 340px");
  assert.ok(html.includes('id="railgrip"'), "a grip on the drawer's edge");
  assert.ok(html.includes('localStorage.getItem("crate.railw"') && html.includes('localStorage.setItem("crate.railw"'), "the width is remembered");
  assert.match(html, /const MIN=240,MAX=640;/, "clamped to a sane band");
});

test("the panel bridge routes Servers + Workspaces; the door bridge lands on the card with ?door=", () => {
  assert.ok(html.includes("window.crateOpenDoor=(door,computer)=>"), "the door bridge exists");
  assert.ok(html.includes('"&card=1&door="'), "…and it deep-links the card");
  assert.ok(html.includes('{new:"acnew",browse:"acbrowse",clone:"acclone",server:"acaddsrv"}'), "the card maps every door");
});

test("mac shell: File / View / Servers / Window / Help, About reads the live engine version, the title follows the page", () => {
  assert.ok(swift.includes('NSMenu(title: "File")'), "File menu");
  for (const t of ["New Project…", "Open Project…", "Clone from GitHub…", "Add a Computer…", "Close Window"]) assert.ok(swift.includes(`"${t}"`), t);
  assert.ok(swift.includes('NSMenu(title: "Computers")') && !swift.includes('NSMenu(title: "Fleet")'), "Fleet is now Computers (the operator's word)");
  assert.ok(swift.includes('host["local"] as? Bool != true, host["cockpitUrl"] != nil'), "this Mac's new-rig row left the Computers menu (File owns it)");
  assert.ok(swift.includes('NSMenu(title: "Window")') && swift.includes('NSMenu(title: "Help")'), "the standard pair");
  assert.ok(swift.includes("app.windowsMenu = windowMenu") && swift.includes("app.helpMenu = helpMenu"), "…registered with AppKit");
  assert.ok(swift.includes("#selector(AppActions.about(_:))") && swift.includes("/api/version?token="), "About asks the hub for the engine version");
  assert.ok(swift.includes(".applicationVersion: engine"), "…and shows it as THE version");
  assert.ok(swift.includes('forKeyPath: "title"') && swift.includes("window.title = t"), "the window title follows the page title");
  assert.ok(!swift.includes("orderFrontStandardAboutPanel(_:)"), "the plist-only About is gone");
});

test("build.sh stamps the shell's provenance (engine sha + build moment) instead of 1.0", () => {
  assert.ok(build.includes("${ENGINE_SHA}") && build.includes("${BUILD_STAMP}"), "stamped");
  assert.ok(!build.includes("<string>1.0</string>"), "no hard-coded 1.0 left");
});

test("linux shell mirrors it: File doors, View gains Workspaces + Servers, Fleet is Servers", () => {
  assert.ok(py.includes('Gtk.MenuItem(label="File")'), "File menu");
  for (const t of ["New Project…", "Open Project…", "Clone from GitHub…", "Add a Computer…"]) assert.ok(py.includes(`"${t}"`), t);
  assert.ok(py.includes('def open_door(self, door, computer="")') && py.includes('"&card=1&door=" + door'), "card doors deep-link the card; dialog doors open in place");
  // Workspace Controls (2026-09-24): the drawer moved into the Workspaces menu — one home per control
  assert.ok(py.includes('Gtk.MenuItem(label="Workspaces")') && py.includes('"Show Workspaces Panel"'), "Workspaces menu owns the drawer");
  assert.ok(!py.includes('("Workspaces", Gdk.KEY_w, "workspaces")') && py.includes('("Dev Servers", Gdk.KEY_5, "servers")'), "View keeps the panels");
  assert.ok(py.includes('Gtk.MenuItem(label="Computers")') && !py.includes('Gtk.MenuItem(label="Fleet")'), "Fleet is now Computers");
  assert.ok(py.includes('not host.get("local")'), "this machine's new-rig row left the Servers menu");
});
