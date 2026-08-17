// CE-108 — an element containing an inline <svg> is invisible to agent-browser's
// text and role locators. The rig filed this as "find text … click silently
// no-ops on flex anchors containing SVG + text". Two parts of that are wrong and
// the tests below pin the corrected shape:
//   - it is NOT silent: the command prints "✗ Element not found" and exits 1;
//   - flex is a red herring, and so is multi-line text. The <svg> child is the
//     entire cause — an <a> with an icon beside its label, i.e. most modern CTAs.
//
// The limitation is UPSTREAM (agent-browser 0.31.1, pinned in core/package.json),
// so the engine's fix is a working recipe in config/skills/qa-method.md: use a
// CSS selector. This file is the TRIPWIRE for that workaround — when a version
// bump makes the text locator work, `svgAnchorStillBroken` starts failing and
// the doc note can be retired instead of quietly outliving the bug.
//
// Skipped when the real binary or a cached chromium is unavailable (a fresh clone
// ships no node_modules) — a tooling probe must never fail a suite for absence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { defaultCacheRoots, chromiumFromCache } from "../src/tools/qa-sweep.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const BIN = join(ROOT, "core", "node_modules", ".bin", "agent-browser");
const chromium = chromiumFromCache(defaultCacheRoots(process.env.HOME ?? ""));
const CAN_RUN = existsSync(BIN) && !!chromium;

const PAGE = `<!doctype html><html><body><div id="log">none</div>
<a id="plain" href="#" onclick="log.textContent='PLAIN';return false">Plain Label</a>
<a id="icon" href="#" style="display:flex;align-items:center;gap:8px"
   onclick="log.textContent='ICON';return false"><svg width="8" height="8"></svg>Icon Label</a>
<a id="multi" href="#" onclick="log.textContent='MULTI';return false">
  Multi Line Label
</a>
<script>var log=document.getElementById('log')</script></body></html>`;

let pageUrl = "";
if (CAN_RUN) {
  const dir = mkdtempSync(join(tmpdir(), "crate2-ce108-"));
  const f = join(dir, "page.html");
  writeFileSync(f, PAGE);
  pageUrl = `file://${f}`;
}

function ab(...args: string[]): { out: string; code: number } {
  try {
    return {
      out: execFileSync(BIN, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: chromium, AGENT_BROWSER_ARGS: "--no-sandbox,--disable-crashpad" },
        timeout: 60_000,
      }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

const clicked = (): string => ab("get", "text", "#log").out.trim().split("\n").pop() ?? "";

test("agent-browser: text locators DO work without an svg — flex and multi-line are innocent (CE-108)", { skip: !CAN_RUN }, () => {
  ab("open", pageUrl);
  assert.equal(ab("find", "text", "Plain Label", "click").code, 0);
  assert.match(clicked(), /PLAIN/);

  ab("open", pageUrl);
  assert.equal(ab("find", "text", "Multi Line Label", "click").code, 0, "wrapped text is fine");
  assert.match(clicked(), /MULTI/);
});

test("agent-browser: an svg child hides the element from EVERY text/role locator — loudly (CE-108)", { skip: !CAN_RUN }, () => {
  ab("open", pageUrl);
  const byText = ab("find", "text", "Icon Label", "click");
  assert.equal(byText.code, 1, "it FAILS — and does so with a non-zero exit, not silently");
  assert.match(byText.out, /Element not found/, "and says so in words a seat can act on");
  assert.doesNotMatch(clicked(), /ICON/, "nothing was clicked");

  // The a11y name misses it too, so "use role instead" is not the workaround.
  ab("open", pageUrl);
  assert.equal(ab("find", "role", "link", "click", "--name", "Icon Label").code, 1);
  assert.doesNotMatch(clicked(), /ICON/);
});

test("agent-browser: a CSS selector reaches it — the documented recipe (CE-108)", { skip: !CAN_RUN }, () => {
  ab("open", pageUrl);
  assert.equal(ab("click", "#icon").code, 0);
  assert.match(clicked(), /ICON/, "the element was always clickable; only the locator failed");

  ab("open", pageUrl);
  assert.equal(ab("click", "a:has(svg)").code, 0, ":has(svg) works when there is no id to grab");
  assert.match(clicked(), /ICON/);
});

test("qa-method documents the svg-locator recipe (CE-108)", () => {
  const doc = readFileSync(join(ROOT, "config", "skills", "qa-method.md"), "utf8");
  assert.match(doc, /INVISIBLE to text locators \(CE-108\)/, "the trap is named where QA will hit it");
  assert.match(doc, /a:has\(svg\)/, "with a selector that works when there is no id");
  assert.match(doc, /never as "the\s*feature is broken"/, "and the false-finding warning");
});

// ── CE-109: a missing nice-to-have must not cost the whole preview ──────────
// build-preview hard-depended on segno: "If segno is unavailable, STOP ... there
// is NO fallback" — so an absent QR renderer killed the entire preview card,
// desktop half included, against the engine's own degrade-don't-fail law (the one
// axe-check follows: "AXE NOT VERIFIED — <why>", exit 0). Worse, the rationale
// section still advertised an external QR API as a "fallback", contradicting the
// step that forbids it — an invitation to resolve the conflict by shipping a
// PRIVATE tunnel URL to a third party.
test("build-preview degrades without segno instead of refusing (CE-109)", () => {
  const doc = readFileSync(join(ROOT, "config", "skills", "build-preview.md"), "utf8");
  assert.match(doc, /DEGRADE, DON'T FAIL \(CE-109\)/, "the law is named where the dependency is used");
  assert.match(doc, /still SHIP THE CARD/, "the card survives a missing QR");
  assert.doesNotMatch(doc, /STOP with that install line as the fix — there is NO fallback/,
    "the old refuse-outright instruction must be gone");
  assert.match(doc, /costs them the whole review/, "and says why the trade-off runs this way");
});

test("build-preview never offers an external QR service (CE-109 safety)", () => {
  const doc = readFileSync(join(ROOT, "config", "skills", "build-preview.md"), "utf8");
  assert.doesNotMatch(doc, /the external API is fallback only/,
    "the contradictory sentence that invited leaking a private tunnel URL is gone");
  assert.match(doc, /Never render the QR via an external web service/);
  assert.match(doc, /deliberately NO external fallback/);
});
