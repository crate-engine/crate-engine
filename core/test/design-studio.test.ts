// Backlog 10 — THE DESIGN STUDIO (PDR dev/pdr/design-studio.md). Laws under
// test: the slot is DERIVED, never reported; the two waiting truths read
// differently; the ROUTING LAW (glass renders through the engine's proxy —
// the loose raw-URL satellite path is gone, Chrome only by explicit press);
// frames are persistent no-focus-theft fixtures; auto-deploy respects a
// mid-task manual close; pure glass (zero added chrome).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { deriveStudioState, type Preview } from "../src/gui/teamctl.js";
import { studioPage } from "../src/gui/studiopage.js";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });
const shell = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "mac-shell", "main.swift"),
  "utf8",
);
const pv = (over: Partial<Preview> = {}): Preview => ({
  url: "http://127.0.0.1:3005", route: "/garage", label: "Garage hub", from: "designer", at: "2026-08-14T13:00:00-05:00", ...over,
});

test("the slot is derived: free slot, dead server, and live design are three distinct truths", () => {
  assert.deepEqual(deriveStudioState([], true, 4646), { mode: "waiting", reason: "awaiting the next design task" });
  const dead = deriveStudioState([pv()], false, 4646);
  assert.equal(dead.mode, "waiting");
  assert.match((dead as { reason: string }).reason, /server went down/, "an occupied slot with a dead server says so — not 'awaiting'");
  const live = deriveStudioState([pv()], true, 4646);
  assert.equal(live.mode, "live");
  if (live.mode === "live") {
    assert.equal(live.proxyPort, 4646, "http targets render through the engine's proxy (the routing law)");
    assert.equal(live.key, "http://127.0.0.1:3005|/garage", "the key names the design under review — auto-deploy diffs on it");
    assert.equal(live.route, "/garage");
  }
});

test("one slot at a time: previews[0] holds it; a non-http target passes through un-proxied", () => {
  const live = deriveStudioState([pv(), pv({ url: "http://other:3000", label: "queued" })], true, 4646);
  if (live.mode === "live") assert.equal(live.label, "Garage hub", "the first registration holds the slot — the second queues");
  const ext = deriveStudioState([pv({ url: "https://staging.example.com" })], true, 4646);
  if (ext.mode === "live") assert.equal(ext.proxyPort, undefined, "https passes through — the proxy is for loopback dev servers");
});

test("the studio page is pure glass: a full-bleed frame, a branded wait, and nothing else", () => {
  const page = studioPage("mobile");
  assert.ok(page.includes("Crate Studio — Mobile"), "the frame names itself");
  assert.ok(page.includes("/api/studio/state"), "the glass polls the DERIVED slot");
  assert.ok(page.includes('"http://"+location.hostname+":"+s.proxyPort'), "live http renders through the proxy — never a raw dev URL");
  assert.ok(page.includes("awaiting the next design task"), "the free-slot truth is on the glass");
  assert.ok(!page.includes("navbtn") && !page.includes("<button"), "zero added chrome — no buttons, no feedback UI");
  assert.ok(studioPage("desktop").includes("Crate Studio — Desktop"));
});

test("the cockpit routes ALL preview windows through the studio — the loose raw-URL satellite path is gone", () => {
  assert.ok(html.includes("window.crateOpenStudio="), "the menu bridge exists");
  assert.ok(html.includes('window.open("/studio?frame="+kind'), "frames load /studio, never a preview URL");
  assert.ok(!html.includes("openSatellite"), "the old loose-URL window path is deliberately dead");
  assert.ok(html.includes('openStudioFrame("mobile")') && html.includes('openStudioFrame("desktop")'), "the Preview overlay's window buttons open studio frames");
  assert.ok(html.includes("crateShell") && html.includes("crate-ext://"), "Launch in Chrome survives ONLY as the explicit press");
});

test("auto-deploy diffs the slot key and respects a mid-task manual close", () => {
  const fn = html.slice(html.indexOf("function studioAutoDeploy"), html.indexOf("setInterval(studioAutoDeploy"));
  assert.ok(fn.includes("key!==STUDIOKEY"), "only a NEW design deploys the frames");
  assert.ok(fn.includes("STUDIOCLOSED.mobile=false"), "a new task clears the closed-flags — the next design re-deploys");
  assert.ok(fn.includes("STUDIOCLOSED[k]=true"), "a frame Adam closed mid-task is remembered and left closed");
});

test("the shell makes studio frames fixtures: remembered positions, no focus theft, mobile UA, cmd-4", () => {
  assert.ok(shell.includes('u.path == "/studio"'), "studio windows are recognized by path");
  assert.ok(shell.includes("CrateStudioMobile") && shell.includes("CrateStudioDesktop"), "each frame remembers its own monitor position");
  const studio = shell.slice(shell.indexOf('u.path == "/studio"'), shell.indexOf("} else {", shell.indexOf('u.path == "/studio"')));
  assert.ok(studio.includes("orderFrontRegardless"), "auto-deploy never steals keyboard focus");
  assert.ok(!studio.includes("makeKeyAndOrderFront"), "…the key-window grab is the non-studio branch only");
  assert.ok(studio.includes("iPhone"), "the mobile frame carries a real device UA (viewport parity with QA)");
  assert.ok(shell.includes('NSMenuItem(title: "Design Studio",') && shell.includes('keyEquivalent: "4"'), "View menu opens the studio on cmd-4");
});
