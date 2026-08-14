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
