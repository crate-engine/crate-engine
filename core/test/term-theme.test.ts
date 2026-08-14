// Backlog 12 (Adam's design gate, locked 2026-08-13): the Crate terminal
// theme. Laws under test: ONE theme object feeds every pane mount (no
// per-CLI config, no stray inline theme); all 16 ANSI slots are present so
// TUIs never fall back to xterm's stock Tango; the brand-token slots carry
// the cockpit's own hexes. Client logic is JS inside the teampage template →
// structural assertions (the gate-bar precedent).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("every pane mounts through the ONE theme object — no inline theme left behind", () => {
  assert.ok(html.includes("const CRATE_TERM_THEME="), "the theme object exists");
  assert.ok(html.includes("theme:CRATE_TERM_THEME"), "the Terminal mount uses it");
  assert.ok(!/theme:\{background/.test(html), "the old inline theme is gone");
});

test("all 16 ANSI slots are defined — a missing slot silently falls back to stock Tango", () => {
  const start = html.indexOf("const CRATE_TERM_THEME=");
  const obj = html.slice(start, html.indexOf(";", start));
  for (const slot of [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
  ]) {
    assert.match(obj, new RegExp(`[^a-zA-Z]${slot}:"#[0-9a-f]{6}"`), `slot ${slot} is themed`);
  }
});

test("the brand slots carry the cockpit's own tokens (the locked palette)", () => {
  const obj = html.slice(html.indexOf("const CRATE_TERM_THEME="));
  assert.match(obj, /yellow:"#e2a33c"/, "yellow = --amber (the signature move)");
  assert.match(obj, /green:"#57c489"/, "green = --ok");
  assert.match(obj, /red:"#e4614d"/, "red = --bad");
  assert.match(obj, /brightBlack:"#6b7488"/, "brightBlack = --faint (the dim-text slot)");
  assert.match(obj, /brightWhite:"#f1f3f6"/, "brightWhite = --fg");
  assert.match(obj, /cursor:"#e2a33c"/, "the amber cursor survives");
});

// ── Backlog 14, styling half (Adam): one scrollbar look everywhere ──

test("the scrollbar is styled ONCE for the whole cockpit: thin, square, brighter-not-thicker on hover", () => {
  assert.ok(html.includes("::-webkit-scrollbar{width:8px"), "explicit thin width — the macOS overlay can't fatten on hover");
  assert.ok(html.includes("::-webkit-scrollbar-thumb{background:var(--line2);border-radius:0}"), "brand-quiet square thumb (rounded-none law)");
  assert.ok(html.includes("::-webkit-scrollbar-thumb:hover{background:#4a5468}"), "hover brightens one step of steel, never thickens");
  assert.ok(html.includes("::-webkit-scrollbar-thumb:active{background:#5a667e}"), "drag brightens a second step — still steel, never loud");
});

test("the PANES' bars match too: xterm's own div scrollbar (not webkit) is pinned to the same 8px square lane", () => {
  // Adam's catch: 'reviewer huge, coder small' — xterm v6 draws a VS Code-
  // style DIV scrollbar the webkit rules never touch; stock width varied.
  assert.ok(html.includes('scrollbarSliderBackground:"#323a4b"'), "slider = --line2 (matches the webkit thumb)");
  assert.ok(html.includes('scrollbarSliderHoverBackground:"#4a5468"'), "hover = one step of steel (subtle — Adam's verify killed the bright rollover)");
  assert.ok(html.includes('scrollbarSliderActiveBackground:"#5a667e"'), "drag = a second step of steel, never amber");
  assert.ok(html.includes(".xterm .xterm-scrollable-element>.scrollbar.vertical{width:8px!important}"), "the lane is 8px like everything else");
  assert.ok(html.includes(">.slider{width:8px!important;left:0!important;border-radius:0!important}"), "…and the slider itself: 8px, flush, square (!important beats xterm's inline styles)");
});

// ── WebGL renderer (2026-08-14, from Adam's red-notch find) ──

test("the panes render on WebGL with a graceful DOM fallback — the cell grid is exact, never ragged", () => {
  assert.ok(html.includes('<script src="/assets/addon-webgl.js"></script>'), "the addon is self-hosted like xterm itself (no CDN law)");
  assert.ok(html.includes("new WebglAddon.WebglAddon()"), "the renderer loads at the pane mount");
  assert.ok(html.includes("gl.onContextLoss"), "a lost GL context disposes back to the DOM renderer — never a dead pane");
  const mount = html.indexOf("new WebglAddon.WebglAddon()");
  assert.ok(html.lastIndexOf("try{", mount) > html.lastIndexOf("term.open(wrap)", mount), "activation is guarded — no GL means the DOM renderer simply stands");
});
