// The 2026-08-18 battle test's five finds (CE-135..139), fixed + pinned.
// Every one was found by Adam DRIVING the shipped build — these tests are
// the "the cure holds" pins for that morning.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { agentProblem } from "../src/detect.js";
import { execTurn } from "../src/runner.js";
import { TeamProcess, type SeatSpawner } from "../src/gui/teamproc.js";
import { teamPage } from "../src/gui/teampage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const stub: SeatSpawner = () => spawn("sleep", ["30"], { stdio: "ignore" });

function rig(): string {
  const p = mkdtempSync(join(tmpdir(), "bf-rig-"));
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), "PROJECT=x\n");
  return p;
}

// ── CE-135: stop() clears seat records — parked is an invitation ────────────

test("CE-135: a deliberate stop leaves NO corpse records — every seat reads unstaffed, not died", () => {
  const p = rig();
  const tp = new TeamProcess(p, stub);
  try {
    tp.boot();
    const st = tp.stop();
    assert.equal(st.seats.filter((s) => s.alive).length, 0, "the stop report shows what was stopped");
    const after = tp.status();
    assert.ok(after.seats.every((s) => s.startedAt === null && s.pid === null), "no startedAt corpses — parked renders as calm invitations");
    assert.equal(after.booted, false);
  } finally {
    tp.stop();
    rmSync(p, { recursive: true, force: true });
  }
});

test("CE-135: a CRASHED seat keeps its record — distress stays distinguishable from parked", async () => {
  const p = rig();
  const tp = new TeamProcess(p, stub);
  try {
    const st = tp.boot();
    const coderPid = st.seats.find((s) => s.seat === "coder")!.pid!;
    process.kill(coderPid, "SIGKILL"); // a crash, not a stop
    await new Promise((r) => setTimeout(r, 200));
    const after = tp.status();
    const coder = after.seats.find((s) => s.seat === "coder")!;
    assert.equal(coder.alive, false);
    assert.ok(coder.startedAt !== null, "the crash record survives — the downchip's evidence");
  } finally {
    tp.stop();
    rmSync(p, { recursive: true, force: true });
  }
});

// ── CE-136: an empty host is never a dead-end in the Fleet menu ─────────────

test("CE-136: fleet rows carry the host's cockpit door, and both shells render '＋ new rig' onto it (&card=1)", () => {
  assert.match(src("core/src/gui/fleet.ts"), /cockpitUrl/, "the brain exposes the door");
  const swift = src("apps/mac-shell/main.swift");
  assert.ok(swift.includes("new rig on"), "mac: the empty-host row is a door, not a label");
  assert.ok(swift.includes('"&card=1"'), "mac: it lands on the summonable card");
  assert.ok(!swift.includes("no workspaces yet"), "mac: the dead placeholder is gone");
  const py = src("apps/linux-shell/main.py");
  assert.ok(py.includes("new rig on"), "linux: same door");
  assert.ok(py.includes('"&card=1"') || py.includes("'&card=1'") || py.includes('+ "&card=1"'), "linux: same card landing");
});

// ── CE-137: a dead picker row must be DEAD ──────────────────────────────────

test("CE-137: the restaff picker binds ONLY rows with data-i — bench rows can never staff ready[0]", () => {
  const html = teamPage({ project: "demo", seats: [] });
  assert.ok(html.includes('querySelectorAll(".pkrow[data-i]")'), "the binding is index-gated");
  const dlg = html.slice(html.indexOf("async function restaffDialog"));
  assert.ok(!/querySelectorAll\("\.pkrow"\)\.forEach\(b=>\{b\.onclick=async/.test(dlg), "the unfiltered binding is gone");
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]!); // whole page still parses
});

// ── CE-138: gemini is API-key-only now — no false-READY on a dead tier ──────

test("CE-138: valid-looking OAuth creds do NOT make gemini ready; only GEMINI_API_KEY does — and the fix says why", () => {
  const home = mkdtempSync(join(tmpdir(), "bf-home-"));
  const bin = mkdtempSync(join(tmpdir(), "bf-bin-"));
  const fake = join(bin, "gemini");
  writeFileSync(fake, "#!/bin/sh\nexit 0\n");
  chmodSync(fake, 0o755);
  mkdirSync(join(home, ".gemini"), { recursive: true });
  writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}"); // valid-looking, unservable (Antigravity)
  const hadKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const p = agentProblem("gemini", home, [], { path: bin });
    assert.ok(p !== undefined, "OAuth creds alone are a false-ready — refused");
    assert.match(p!.fix, /GEMINI_API_KEY/, "the fix names the only working path");
    assert.match(p!.fix, /retired/i, "and says WHY (Google killed the free tier)");
    process.env.GEMINI_API_KEY = "test-key";
    assert.equal(agentProblem("gemini", home, [], { path: bin }), undefined, "an API key is ready");
  } finally {
    if (hadKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = hadKey;
    rmSync(home, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("CE-138: the catalog's billing line stopped advertising the dead free tier", () => {
  const server = src("core/src/gui/server.ts");
  assert.ok(!server.includes("Google account sign-in (free tier)"), "the false line is gone");
  assert.match(server, /GEMINI_API_KEY required/, "the truth stands in its place");
});

// ── CE-139: the first-output fuse — silence is a wedge, not patience ────────

test("CE-139: an agent that emits NOTHING is killed by the first-output fuse, with an honest error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bf-turn-"));
  try {
    const r = await execTurn(
      { argv: ["/bin/sh", "-c", "sleep 30"], stdin: "ignore" },
      dir, join(dir, "t.jsonl"), "gemini", 60_000,
      { ...process.env, CRATE_FIRST_OUTPUT_MS: "300" },
    );
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no output within 300ms/, "the wedge is named, never a silent wait");
    assert.match(r.error ?? "", /CE-139 fuse/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CE-139: first output on EITHER stream disarms the fuse — a slow-but-talking turn is never killed early", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bf-turn2-"));
  try {
    // stderr first (the gemini failure shape), then a slow finish well past the fuse window
    const r = await execTurn(
      { argv: ["/bin/sh", "-c", "echo warming >&2; sleep 1; echo done; exit 0"], stdin: "ignore" },
      dir, join(dir, "t.jsonl"), "gemini", 60_000,
      { ...process.env, CRATE_FIRST_OUTPUT_MS: "300" },
    );
    assert.equal(r.ok, true, "talking turns run to completion");
    const log = readFileSync(join(dir, "t.jsonl"), "utf8");
    assert.match(log, /warming/, "the stderr tail is in the capture — the evidence the fuse points at");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
