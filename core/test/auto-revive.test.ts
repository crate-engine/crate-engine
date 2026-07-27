// PHASE-7 T5 — auto-revive: strictly opt-in, dead-only, backoff + a hard
// ceiling that provably stops a crash-looping seat (the always-dying fake).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { autoReviveEnabled, makeAutoReviver, type SeatHealth } from "../src/health.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-revive5-"));

function rigWith(conf: string | undefined): string {
  const rig = join(scratch, `rig-${Math.abs((conf ?? "none").length * 31) % 100000}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(rig, ".agents"), { recursive: true });
  if (conf !== undefined) writeFileSync(join(rig, ".agents", "rig.conf"), conf);
  return rig;
}

const seat = (liveness: SeatHealth["liveness"]): SeatHealth =>
  ({ seat: "coder", title: "Coder", agent: "pi", model: "x", liveness, detail: "" }) as SeatHealth;

test("OPT-IN: absent / 0 / off = disabled; only an explicit truthy value enables", () => {
  assert.equal(autoReviveEnabled(rigWith('PROJECT="r"\n')), false, "fresh install stays button-only");
  assert.equal(autoReviveEnabled(rigWith('AUTO_REVIVE="0"\n')), false);
  assert.equal(autoReviveEnabled(rigWith('AUTO_REVIVE="off"\n')), false);
  assert.equal(autoReviveEnabled(rigWith('AUTO_REVIVE="1"\n')), true);
  assert.equal(autoReviveEnabled(rigWith(undefined)), false, "no rig.conf = off");
  // the attach seed itself ships the flag OFF
  assert.match(readFileSync(join(ROOT, "core", "src", "attach.ts"), "utf8"), /AUTO_REVIVE="0"/);
});

test("only DEAD seats revive — unknown (fail-safe) and signed-out (human call) never do", async () => {
  const calls: string[] = [];
  const r = makeAutoReviver({ revive: async (s) => void calls.push(s) });
  await r.tick([seat("unknown"), seat("signed-out"), seat("live")], "workspace:9");
  assert.deepEqual(calls, []);
  const notes = await r.tick([seat("dead")], "workspace:9");
  assert.deepEqual(calls, ["coder"]);
  assert.equal(notes[0]!.detail, "auto-revived (1/3)");
});

test("the ceiling provably stops an always-dying seat (one honest stopped note, then silence)", async () => {
  let clock = 0;
  const calls: number[] = [];
  const r = makeAutoReviver({
    revive: async () => void calls.push(clock),
    baseBackoffMs: 1000,
    now: () => clock,
  });
  const dead = [seat("dead")];
  await r.tick(dead, "w"); // revive 1 (immediate)
  await r.tick(dead, "w"); // inside backoff (2s) — skipped
  assert.equal(calls.length, 1, "backoff must hold");
  clock = 2_100;
  await r.tick(dead, "w"); // revive 2
  clock = 4_000;
  await r.tick(dead, "w"); // inside backoff (4s from t=2100) — skipped
  assert.equal(calls.length, 2);
  clock = 7_000;
  await r.tick(dead, "w"); // revive 3 — the ceiling
  assert.equal(calls.length, 3);
  clock = 60_000;
  const stopNotes = await r.tick(dead, "w"); // over the ceiling → ONE stopped note
  assert.equal(calls.length, 3, "no revive past the ceiling");
  assert.equal(stopNotes.length, 1);
  assert.equal(stopNotes[0]!.stopped, true);
  assert.match(stopNotes[0]!.detail, /STOPPED for this seat; check it/);
  clock = 120_000;
  assert.deepEqual(await r.tick(dead, "w"), [], "the stopped note is said ONCE");
});

test("a seat seen LIVE again resets its episode (intermittent deaths don't accumulate forever)", async () => {
  let clock = 0;
  const calls: number[] = [];
  const r = makeAutoReviver({ revive: async () => void calls.push(clock), baseBackoffMs: 1000, now: () => clock });
  await r.tick([seat("dead")], "w");
  await r.tick([seat("live")], "w"); // healthy → episode cleared
  clock = 10;
  const notes = await r.tick([seat("dead")], "w"); // a NEW episode, immediate again
  assert.equal(calls.length, 2);
  assert.equal(notes[0]!.detail, "auto-revived (1/3)");
});

test("a FAILING revive still counts toward the ceiling (an erroring relauncher must not retry forever)", async () => {
  let clock = 0;
  const r = makeAutoReviver({
    revive: async () => {
      throw new Error("cmux unreachable");
    },
    ceiling: 2,
    baseBackoffMs: 1,
    now: () => clock,
  });
  const n1 = await r.tick([seat("dead")], "w");
  assert.match(n1[0]!.detail, /FAILED: cmux unreachable/);
  clock = 1_000;
  await r.tick([seat("dead")], "w");
  clock = 60_000;
  const n3 = await r.tick([seat("dead")], "w");
  assert.equal(n3[0]!.stopped, true);
});

test("doctrine/UI pins: health API exposes the notes; the cockpit Team menu renders the card; the flag stays documented", () => {
  const server = readFileSync(join(ROOT, "core", "src", "gui", "server.ts"), "utf8");
  assert.match(server, /autoRevive: autoReviveEnabled/);
  assert.match(server, /reviveNotes/);
  assert.match(server, /monitor must never crash the GUI server/);
  // W1: the /health wizard page retired — the auto-revive surface lives in the
  // cockpit's Team menu now (the lifecycle surface).
  const teampage = readFileSync(join(ROOT, "core", "src", "gui", "teampage.ts"), "utf8");
  assert.match(teampage, /revivecard/);
  assert.match(teampage, /AUTO_REVIVE=1; dead seats relaunch with backoff/);
});
