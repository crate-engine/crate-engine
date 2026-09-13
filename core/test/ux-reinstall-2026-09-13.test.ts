// Re-install run 2026-09-13 — three things Adam noticed while staffing the
// fresh rig, each pinned here:
//  (1) "1/5 seats staffed… in RED" — an unstaffed seat is not a dead one.
//  (2) the picker "lagging, I kept clicking" — the catalog's deep sign-in
//      probes ran SYNCHRONOUSLY on the request path (3s+ freeze of the whole
//      engine on first open, no UI feedback, and every click stacked a dialog).
//  (3) "typing lags at times" — the same class: any execFileSync on a polled
//      route stalls every keystroke; the Health panel's git fetch was one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamPage } from "../src/gui/teampage.js";
import { agentProblemAsync } from "../src/detect.js";

const html = teamPage({ project: "demo", seats: [] });

function agyMarkerHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ux0913-home-"));
  const cache = join(home, ".gemini", "antigravity-cli", "cache");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "onboarding.json"), JSON.stringify({ onboardingComplete: true }));
  return home;
}
/** A PATH dir whose `agy models` takes `sleepSec` before answering READY. */
function slowAgyBin(sleepSec: number): string {
  const dir = mkdtempSync(join(tmpdir(), "ux0913-bin-"));
  const bin = join(dir, "agy");
  writeFileSync(bin, `#!/bin/sh\nsleep ${sleepSec}\nprintf 'gemini-3-pro\\n'\nexit 0\n`);
  chmodSync(bin, 0o755);
  return dir;
}

// ── (1) the chips ────────────────────────────────────────────────────────────

test("the red downchip counts only seats that STARTED and died — never the unstaffed ones", () => {
  assert.match(html, /const dead=ps\.booted\?ps\.seats\.filter\(x=>!x\.alive&&x\.startedAt\):\[\];/);
});

test("staffing progress is a GREEN chip that reads like progress, and hides once all seats are live", () => {
  assert.ok(html.includes('id="upchip"'), "the progress chip exists in the header");
  assert.match(html, /\.upchip\{[^}]*color:var\(--ok\)/, "and it is the OK green, not the distress red");
  assert.match(html, /seats staffed — "\+\(n-staffed\)\+" to go/, "N/5 staffed — K to go (the template cooks \\u2014 into the dash)");
  assert.match(html, /all "\+n\+" seats live/, "…then a brief 'all seats live'");
});

// ── (2) the picker ───────────────────────────────────────────────────────────

test("the picker opens ON the click with a reading state, and a second click nudges instead of stacking", () => {
  const dlg = html.slice(html.indexOf("async function restaffDialog"));
  assert.match(dlg, /RESTAFF_OPEN&&RESTAFF_OPEN\.isConnected/, "single-flight guard");
  assert.match(dlg, /classList\.add\("nudge"\)/, "the open dialog is nudged, not duplicated");
  const open = dlg.indexOf("uiDialog(");
  const fetchAt = dlg.indexOf('fetch(api("/api/staffing")');
  assert.ok(open > 0 && fetchAt > open, "the dialog is created BEFORE the catalog fetch — feedback first");
  assert.ok(dlg.includes("Reading your agents"), "and it says what it is waiting for");
  assert.match(dlg, /if\(!d\.isConnected\)return;/, "a cancel during the load fills nothing");
});

test("agentProblemAsync honours the ceiling and never reads a hung probe as READY", async () => {
  const home = agyMarkerHome();
  const dir = slowAgyBin(30);
  try {
    const t0 = Date.now();
    const p = await agentProblemAsync("agy", home, [""], { path: dir, deepTimeoutMs: 500 });
    assert.ok(p !== undefined, "hung = NOT ready");
    assert.ok(Date.now() - t0 < 5000, "the ceiling held");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("END TO END: a slow sign-in probe no longer freezes the engine — other routes answer while the catalog waits", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const home = agyMarkerHome();
  const dir = slowAgyBin(2);
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home, detectPath: dir });
    const h = { headers: { "X-Crate-Token": server.token } };
    const base = `http://127.0.0.1:${server.port}`;
    // the picker's request goes out (the boot warm-up may already be probing —
    // the in-flight dedupe makes both wait on ONE subprocess either way)
    const staffing = fetch(`${base}/api/staffing`, h).then((r) => r.json() as Promise<{ models: Array<{ agent: string; ready: boolean }> }>);
    await new Promise((r) => setTimeout(r, 150));
    // meanwhile: a keystroke-class route must answer NOW, not after the probe
    const t0 = Date.now();
    const st = await fetch(`${base}/api/team/status`, h);
    const dt = Date.now() - t0;
    assert.equal(st.status, 200);
    assert.ok(dt < 700, `the engine stalled ${dt}ms behind the probe — that is the freeze Adam clicked through`);
    const body = await staffing;
    const agy = body.models.filter((m) => m.agent === "agy");
    assert.ok(agy.length > 0 && agy.every((m) => m.ready), "the slow-but-live credential is still offered");
    // and the verdict is on file: the next open is instant
    const t1 = Date.now();
    await fetch(`${base}/api/staffing`, h);
    assert.ok(Date.now() - t1 < 500, "second open reads the cached verdict");
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (3) the polled routes ────────────────────────────────────────────────────

test("/api/version answers from a cached update check — no git fetch on the request path", async () => {
  const { engineVersionFast } = await import("../src/gui/server.js");
  const home = mkdtempSync(join(tmpdir(), "ux0913-vh-"));
  try {
    const t0 = Date.now();
    const a = engineVersionFast(home);
    const b = engineVersionFast(home);
    assert.ok(Date.now() - t0 < 400, "two calls, no network wait");
    assert.equal(typeof a.version, "string");
    assert.equal(typeof b.updateAvailable, "boolean");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
