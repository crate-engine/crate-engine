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

test("the page exposes the copy bridge: NEWEST non-empty xterm selection wins, DOM selection fallback", () => {
  assert.ok(html.includes("window.crateCopySelection=function()"), "the bridge exists");
  const fn = html.slice(html.indexOf("window.crateCopySelection"), html.indexOf("};", html.indexOf("window.crateCopySelection")));
  assert.ok(fn.includes("hasSelection()"), "xterm selections win (WebKit can't see them)");
  assert.ok(fn.includes("t.selAt"), "recency decides — a stale selection in another pane never shadows the fresh one");
  assert.ok(fn.includes("if(sel&&"), "empty-text selections (blank rows) never stop the scan");
  assert.ok(fn.includes("getSelection"), "plain DOM selections still copy (chat text)");
});

test("the KEEPER: a no-gesture clear (alt-screen flip) puts the selection BACK, validated against the remembered text", () => {
  // root cause #3 (the coder/reviewer vs claude split): claude's TUI flips
  // the alt screen during redraws; EVERY buffer switch clears the selection
  // through a path the disable patch can't cover. pi/deepseek don't flip.
  assert.ok(html.includes("t.selPos={s:p.start,e:p.end,n:0}"), "the selection RANGE is remembered, not just the text");
  assert.ok(html.includes("pos.n>=10"), "restores are capped — never an infinite tug-of-war");
  assert.ok(html.includes("t.lastDownAt&&Date.now()-t.lastDownAt<600"), "a deliberate click stays a deselect");
  assert.ok(html.includes("t.lastKeyAt&&Date.now()-t.lastKeyAt<600"), "typing stays an input-clear (terminal law)");
  assert.ok(html.includes("term.select(pos.s.x,pos.s.y,len)"), "the range is re-applied");
  assert.ok(html.includes("term.getSelection()!==t.selText)term.clearSelection()"), "a wrong-content restore is cleared, never left to feed a copy");
});

test("the selection SURVIVES the TUI's mouse-mode re-asserts, and Cmd+C keeps a 20s memory", () => {
  // root cause #2 (Adam's live find): claude re-asserts DECSET tracking on
  // redraws; xterm's protocol-change handler calls selectionService.disable()
  // which CLEARS the selection. The patch keeps the flag, drops the clear.
  assert.ok(html.includes("ss.disable=()=>{ss._enabled=false;}"), "disable() flips the flag but never clears (forced gestures ignore the flag)");
  assert.ok(html.includes("term._core&&term._core._selectionService"), "…guarded private-API surgery — an xterm upgrade degrades, never breaks");
  assert.ok(html.includes("t.selText=sel"), "non-empty selections are remembered");
  assert.ok((html.match(/Date\.now\(\)-t\.selAt<20000/g) || []).length >= 2, "the 20s memory backs BOTH doors (in-page Cmd+C and the native bridge)");
  assert.ok(html.includes('wrap.addEventListener("mousedown",()=>{t.selText=null;t.selPos=null;t.lastDownAt=Date.now();}'), "a new gesture forgets the memory AND stamps the gesture clock for the keeper");
});

test("drag-to-select is cockpit law: tracking TUIs (claude) can't swallow the drag", () => {
  assert.ok(html.includes("macOptionClickForcesSelection:true"), "the mac force switch is ON (xterm ships it off)");
  assert.ok(html.includes("altClickMovesCursor:false"), "…without alt-click teleporting the TUI cursor");
  assert.ok(html.includes('term.modes.mouseTrackingMode==="none"'), "panes with tracking OFF are untouched (shift-click keeps extending)");
  assert.ok(/Object\.defineProperty\(e,"altKey"/.test(html), "a plain drag in a tracking pane is forced into a selection gesture");
  assert.ok(html.includes("term.onSelectionChange"), "selections stamp recency for the bridge");
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
