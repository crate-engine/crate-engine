// Pane clipboard — both doors pinned. The browser door (2026-08-13 polish):
// in-page Cmd+C with execCommand fallback (WKWebView's async clipboard
// silently rejects). The NATIVE door (Adam's live find, 2026-08-14): the
// mac shell's Edit menu consumes Cmd+C BEFORE the page sees it, and
// WebKit's copy: only knows DOM selections — xterm paints its own, so the
// app beeped and copied nothing. The shell now calls
// window.crateCopySelection and writes the pasteboard itself.
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

test("the page exposes the copy bridge: xterm selection first, DOM selection fallback, empty = silence", () => {
  assert.ok(html.includes("window.crateCopySelection=function()"), "the bridge exists");
  const fn = html.slice(html.indexOf("window.crateCopySelection"), html.indexOf("};", html.indexOf("window.crateCopySelection")));
  assert.ok(fn.includes("hasSelection()"), "xterm selections win (WebKit can't see them)");
  assert.ok(fn.includes("getSelection"), "plain DOM selections still copy (chat text)");
});

test("the browser door survives: in-page Cmd+C with the execCommand fallback", () => {
  assert.ok(html.includes("execCommand(\"copy\")") || html.includes("execCommand('copy')"), "the WKWebView-safe fallback stays");
  assert.ok(html.includes("attachCustomKeyEventHandler"), "the in-page key handler stays for plain browsers");
});

test("the shell's Copy targets the bridge, never WebKit's DOM-only copy: (the beep)", () => {
  assert.ok(shell.includes("crateCopySelection"), "the shell asks the page for the real selection");
  assert.ok(shell.includes("copyItem.target = EditActions.shared"), "explicit target — the key equivalent can't fall through to copy:");
  assert.ok(!shell.includes('withTitle: "Copy", action: #selector(NSText.copy'), "the old DOM-only Copy item is gone");
  assert.ok(shell.includes("NSPasteboard.general"), "…and writes the pasteboard natively");
});
