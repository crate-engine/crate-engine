// Cockpit-first onboarding S3 — KILL THE PAGES (PDR): the wizard journey is
// dead (route redirects are pinned in gui.test.ts); the Team panel absorbs
// the dead /start page's whole-team preflight honesty; the card becomes the
// one attach surface, summonable over a working cockpit. Client logic is JS
// inside the teampage template → structural assertions (the gate-bar precedent).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";

const html = teamPage({ project: "demo", seats: [] });

test("the wizard pages module is DELETED, not orphaned", () => {
  assert.ok(!existsSync(join(import.meta.dirname, "..", "src", "gui", "pages.ts")), "src/gui/pages.ts is gone");
});

test("the Team panel absorbs the /start preflight: tools → wiring → crew → boot, in that order", () => {
  const pf = html.slice(html.indexOf("async function bootWithPreflight"), html.indexOf("async function renderTeamMenu"));
  assert.ok(pf.length > 0, "bootWithPreflight exists");
  const order = ["Tools your seats need", "Wiring check", "Crew sign-ins", "Boot the team"];
  let at = -1;
  for (const step of order) {
    const i = pf.indexOf(step);
    assert.ok(i > at, `${step} present and in order`);
    at = i;
  }
  assert.ok(pf.includes("install-one"), "tools install one at a time (the live-clock honesty)");
  assert.ok(pf.includes("nothing here blocks the boot"), "doctor ambers surface, never block");
  assert.ok(pf.includes("not signed in") && pf.includes("hold();return;"), "crew sign-ins gate HARD with the honest fix");
  assert.ok(pf.includes("seats live"), "the boot shows a live seat count");
  assert.ok(pf.includes("Retry is safe"), "a stuck boot holds the row open with Retry");
});

test("boot goes through the preflight; the dead pages' buttons are gone; the card is summonable", () => {
  assert.match(html, /bootB\.onclick=bootWithPreflight/);
  assert.ok(!html.includes('id="tstaffing"'), "the Staffing-screen button is retired — staffing lives on the pane corners");
  assert.ok(!html.includes('/staffing?token='), "nothing links to the dead staffing page");
  assert.ok(!html.includes('/attach?token='), "nothing links to the dead attach page");
  assert.match(html, /card=1/); // Team panel summons the card center-cockpit
});

test("the summoned card is dismissable back to the rig; the fresh-account card is not", () => {
  const summoned = teamPage({ project: "", seats: [] }, { attachCard: { machine: "This Mac", dismissable: true } });
  assert.match(summoned, /"dismissable":true/);
  const fresh = teamPage({ project: "", seats: [] }, { attachCard: { machine: "This Mac" } });
  assert.match(fresh, /"dismissable":false/);
  assert.ok(summoned.includes("acdismiss"), "the dismiss door renders from the flag");
});
