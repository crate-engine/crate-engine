// Cockpit-first onboarding S2 — STAFFING-IN-PANE (PDR decisions 4–7):
// five named panes always present, one amber invitation on unstaffed seats,
// the corner label doubles as the staffing door, picking BOOTS the seat,
// engine-drawn status dots removed, picker carries sign-in honesty inline.
// Client logic is JS inside the teampage template → structural assertions
// (the gate-bar precedent); boot-on-staff is pinned on TeamProcess itself.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { teamPage } from "../src/gui/teampage.js";
import { TeamProcess, type SeatSpawner } from "../src/gui/teamproc.js";

const html = teamPage({ project: "demo", seats: [] });

test("the engine-drawn colored status dots are GONE — a staffed seat is clean chrome", () => {
  assert.ok(!html.includes("dotClass"), "the dot classifier is deleted, not orphaned");
  assert.ok(!/class="dot /.test(html), "no tile renders a status dot");
  assert.ok(!/\.dot\{/.test(html), "the dot CSS block is gone");
  // the ONE piece of chrome left in the grid: the amber invitation
  assert.ok(/\.invite\{/.test(html), "the invitation dot's style exists");
  assert.match(html, /invitation, not a status/);
});

test("an unstaffed seat invites: amber dot beside the role name; the corner reads '＋ staff this seat' through the SAME restaff door", () => {
  assert.ok(html.includes("function seatUnstaffed"), "the unstaffed derivation exists");
  assert.ok(html.includes("＋ staff this seat"), "the corner invitation label");
  const head = html.slice(html.indexOf("function tileHead"));
  assert.ok(/staffdoor" data-restaff=/.test(head), "the invitation IS the restaff picker's door — one home for one control");
  // dead ≠ unstaffed: a runner that started and died is distress, not an invitation
  assert.match(html, /!s\._alive&&!s\._started&&!s\.ptyStartedAt/);
});

test("the five named panes are ALWAYS there — placeholders carry their role names, dimmed", () => {
  assert.match(html, /THE FIVE NAMED PANES ARE ALWAYS THERE/);
  assert.ok(/unstaffed" data-seat="'\+esc\(seat\)\+'"><div class="thead"><span class="tname">'\+esc\(TITLES\[seat\]/.test(html), "placeholder tiles render the role name");
});

test("the picker carries the Welcome page's honesty inline: green rows offerable; amber = one command away; grey = absent", () => {
  const dlg = html.slice(html.indexOf("async function restaffDialog"));
  assert.ok(dlg.includes("not signed in"), "amber tier present");
  assert.ok(dlg.includes("not installed"), "grey tier present");
  assert.ok(/a\.fix/.test(dlg), "the one command rides the amber row");
  assert.ok(dlg.includes("boots this seat immediately"), "the staff-boots-immediately promise is said out loud");
});

test("liveness folds into the seats off the status poll, and survives a blip (no five-pane 'unstaffed' lie)", () => {
  assert.match(html, /ALIVEMAP\[x\.seat\]=\{a:x\.alive,s:!!x\.startedAt\}/);
  assert.match(html, /s\._alive,s\._started/); // the dirty key repaints the transition
});

test("boot-on-staff physics: relaunch(seat) from a COLD team boots exactly that seat — the first staff brings the rig live", () => {
  const p = mkdtempSync(join(tmpdir(), "staffboot-"));
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=x\n");
  const stub: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });
  const tp = new TeamProcess(p, stub);
  try {
    assert.equal(tp.booted, false);
    const st = tp.relaunch("coder");
    assert.equal(st.booted, true, "one staffed seat = the rig is live");
    assert.equal(st.seats.filter((s) => s.alive).length, 1, "exactly the staffed seat runs");
    assert.ok(st.seats.find((s) => s.seat === "coder")!.alive);
    const st2 = tp.relaunch("tester"); // each subsequent staff JOINS
    assert.equal(st2.seats.filter((s) => s.alive).length, 2);
  } finally {
    tp.stop();
  }
});
