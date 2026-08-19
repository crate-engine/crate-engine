// CE-151 — a seat's own escape chatter flooded the window CE-143 reads.
//
// Found by the battle test (docs/manual/battle-test.md, rung B1) on 2026-08-18,
// on a real five-seat rig with an `agy` coder. `normalizePaneText()` stripped
// kitty graphics, OSC and CSI — but its CSI parameter class was `[0-9;?]`, and
// ECMA-48 defines the parameter bytes as the whole range 0x30-0x3F. The four it
// omitted (`:`, `<`, `=`, `>`) are exactly the ones terminals use for PRIVATE
// modes, so ESC[>4;2m, ESC[=1;1u, ESC[<u, ESC[>1u and ESC[>0q survived
// "normalisation" verbatim, along with the two-byte ESC7/ESC8 that CSI never
// covered at all.
//
// Measured on the live rig: all five seats had a 2000-char detection window that
// was 100% surviving escapes and ZERO characters of text. It bit `agy` hardest
// because an idle agy pane GROWS ~638 B/min of this chatter while an idle claude
// pane is completely static — so a usage-limit banner scrolled out of the window
// after about four minutes and the seat read LIVE again.
//
// That is worse than the bug CE-143 cured, not equal to it: the seat reports
// usage-limited correctly for a few minutes and then quietly reverts to green,
// and a usage-limited seat is IDLE BY DEFINITION, which is exactly the state
// that accrues the chatter. CE-143's own 11 tests passed throughout, because
// they feed synthetic panes made of clean text. So the fixtures here are REAL
// panes captured off the running rig — a hand-written pane is what hid this.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PANE_TAIL_CHARS, normalizePaneText, paneUsability } from "../src/health.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** Captured 2026-08-18 off the battle-test rig's live seats. */
const AGY_PANE = fixture("agy-idle-pane.raw");
const CLAUDE_PANE = fixture("claude-idle-pane.raw");

/** The banner from the live CE-143 incident, verbatim. */
const BANNER = "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.";

/** One unit of the chatter an idle agy pane emits, taken from its own bytes. */
const IDLE_CHATTER = "\x1b[>4;2m\x1b[=1;1u";
/** Measured: 638 B/min on the live rig, i.e. ~46 of the 14-byte unit. */
const CHATTER_UNITS_PER_MIN = 46;

test("no escape sequence survives normalisation of a REAL pane", () => {
  for (const [label, raw] of [
    ["agy", AGY_PANE],
    ["claude", CLAUDE_PANE],
  ] as const) {
    const left = normalizePaneText(raw).match(/\x1b/g) ?? [];
    assert.equal(left.length, 0, `${label}: ${left.length} escape sequences survived normalisation`);
  }
});

test("the private-mode sequences that actually leaked are each stripped", () => {
  // Named individually so a future narrowing of the class fails HERE, with the
  // offending sequence in the message, rather than as a mysterious detector miss.
  for (const seq of ["\x1b[>4;2m", "\x1b[=1;1u", "\x1b[<u", "\x1b[>1u", "\x1b[>0q", "\x1b[>4m", "\x1b[=0;1u", "\x1b7", "\x1b8"]) {
    assert.equal(
      normalizePaneText(`before${seq}after`),
      "beforeafter",
      `${JSON.stringify(seq)} survived — CSI parameter bytes are the WHOLE 0x30-0x3f range`,
    );
  }
});

test("ordinary text and ordinary SGR are untouched", () => {
  // The guard against over-stripping: a fix that eats the words is not a fix.
  assert.equal(normalizePaneText("\x1b[32mran tests: 42 passing\x1b[0m\r\n"), "ran tests: 42 passing\r\n");
  assert.equal(normalizePaneText(`plain ${BANNER}`), `plain ${BANNER}`);
});

test("a REAL live pane's detection window is text, not noise", () => {
  // The measurement that exposed this: before the fix, tail = 1483 chars of
  // which 1483 were escapes and 0 were text, on every one of five seats.
  for (const [label, raw] of [
    ["agy", AGY_PANE],
    ["claude", CLAUDE_PANE],
  ] as const) {
    const tail = normalizePaneText(raw).slice(-PANE_TAIL_CHARS);
    assert.equal((tail.match(/\x1b/g) ?? []).length, 0, `${label}: the window still contains escapes`);
    assert.ok(tail.trim().length > 100, `${label}: the window carries only ${tail.trim().length} chars of text`);
  }
});

test("THE REGRESSION: a usage-limited agy seat still reads usage-limited hours later", () => {
  // The failure, replayed on the real pane with the real banner and the seat's
  // own real chatter. Before the fix this flipped to "reads LIVE" at ~4 minutes.
  // Four hours is not paranoia — CE-143 was filed over NINE MINUTES of silence,
  // and a capped seat sits there until someone looks.
  for (const mins of [0, 4, 10, 60, 240]) {
    const stuck = `${AGY_PANE}\r\n${BANNER}\r\n${IDLE_CHATTER.repeat(CHATTER_UNITS_PER_MIN * mins)}`;
    assert.equal(
      paneUsability(stuck)?.liveness,
      "usage-limited",
      `after ${mins} min of the seat's own idle chatter the banner was evicted and the seat read live`,
    );
  }
});

test("…and the false positive CE-143 was designed around still cannot happen", () => {
  // The other direction, restated on a real pane: a seat that DISCUSSES a usage
  // limit and then keeps working is not flagged. Stripping more escapes must not
  // buy detection by making the window bigger in the wrong way.
  const discussed = `I'm adding handling for when the API says "usage limit reached".\n`;
  const kept_working = `${"working on it. ".repeat(200)}\nedited src/api.ts\nran tests: 42 passing\n`;
  assert.equal(paneUsability(`${CLAUDE_PANE}${discussed}${kept_working}`), undefined);
});

test("an idle agy pane is almost entirely chatter — which is why a fixed window needed this", () => {
  // Records the ratio that made the eviction so fast, so the next person to
  // touch PANE_TAIL_CHARS knows what fills a pane when nothing is happening.
  const ratio = normalizePaneText(AGY_PANE).length / AGY_PANE.length;
  assert.ok(ratio < 0.15, `an idle agy pane normalised to ${Math.round(ratio * 100)}% of its bytes — expected well under 15%`);
});
