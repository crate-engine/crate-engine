// CE-014 — PANE REHYDRATION: "close the app, open it again, my sessions come
// back" (Adam's cmux contract, 2026-08-17).
//
// The conversation already came back before this build: turns/<seat>/session.json
// holds the seat's session id and startSeatTty resumes it (`claude --resume`,
// `codex resume`, pi's pre-minted id). What did NOT come back was the pane's
// SCROLLBACK — the replay ring lived only in the engine process's memory, so a
// rehydrated seat opened visually blank and read as a lost session even though
// the agent remembered everything.
//
// The ring is now mirrored to turns/<seat>/pane.raw and restored when a spawn
// RESUMES. The law that matters most is the second one below: a FRESH spawn must
// clear the mirror. A clean-eyes worker showing the previous task's scrollback
// would be worse than a blank pane — it is the exact confusion fresh-per-task
// exists to remove.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  dropPaneHistory,
  paneResumeBanner,
  readPaneHistory,
  startSeatTty,
  evictSeatTty,
} from "../src/ptyseat.js";
import { execFileSync } from "node:child_process";
import { sessionFile, turnsDir } from "../src/runner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkRig(name: string): string {
  const rig = join(mkdtempSync(join(tmpdir(), "crate2-pane-")), name);
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  return rig;
}

const pane = (rig: string, seat: string): string => join(turnsDir(rig, seat), "pane.raw");

function seedPane(rig: string, seat: string, text: string): void {
  mkdirSync(turnsDir(rig, seat), { recursive: true });
  writeFileSync(pane(rig, seat), text);
}

function seedSession(rig: string, seat: string, agent = "claude"): void {
  mkdirSync(turnsDir(rig, seat), { recursive: true });
  writeFileSync(sessionFile(rig, seat), JSON.stringify({ agent, sessionId: "sess-abc-123" }));
}

// ── the pure helpers ────────────────────────────────────────────────────────

test("readPaneHistory: absent mirror reads as empty, never throws (CE-014)", () => {
  const rig = mkRig("absent");
  assert.equal(readPaneHistory(rig, "coder").length, 0);
});

test("readPaneHistory: TAIL-caps, so a huge mirror cannot blow up a repaint (CE-014)", () => {
  const rig = mkRig("cap");
  seedPane(rig, "coder", "A".repeat(500) + "TAIL");
  const got = readPaneHistory(rig, "coder", 100).toString("utf8");
  assert.equal(got.length, 100, "exactly the cap");
  assert.ok(got.endsWith("TAIL"), "the tail is what a viewer wants — the newest output");
});

test("dropPaneHistory: removes the mirror and is idempotent (CE-014)", () => {
  const rig = mkRig("drop");
  seedPane(rig, "coder", "old scrollback");
  assert.ok(existsSync(pane(rig, "coder")));
  dropPaneHistory(rig, "coder");
  assert.ok(!existsSync(pane(rig, "coder")));
  dropPaneHistory(rig, "coder"); // twice must not throw
});

test("paneResumeBanner names the seam so restored history cannot pass as live (CE-014)", () => {
  const b = paneResumeBanner("2026-08-17T09:00:00-05:00").toString("utf8");
  assert.match(b, /session restored/);
  assert.match(b, /2026-08-17T09:00:00-05:00/, "stamped, so the operator can see HOW old it is");
  assert.match(b, /before the engine restarted/, "and why there is a gap");
});

// ── the spawn behaviour, driven through the REAL startSeatTty ───────────────
// argvOverride gives a spawnable stub (the ptyseat.test.ts pattern), so these
// exercise the real hydrate/drop decision without needing an agent CLI.

const STUB = ["bash", "-c", "printf 'live output\\n'; sleep 0.4"];

async function spawnStub(rig: string, seat: string): Promise<void> {
  const r = await startSeatTty({
    projectRoot: rig,
    seat: seat as never,
    agent: "claude",
    blended: true,
    argvOverride: STUB,
  });
  assert.ok(r.ok, `stub spawn failed: ${JSON.stringify(r)}`);
  await new Promise((res) => setTimeout(res, 250));
}

test("RESUMING spawn restores prior scrollback, banner-separated (CE-014)", async () => {
  const rig = mkRig("resume");
  seedSession(rig, "coder");                       // a session to resume
  seedPane(rig, "coder", "PREVIOUS TASK OUTPUT");  // what the last engine showed
  await spawnStub(rig, "coder");

  const replay = readPaneHistory(rig, "coder").toString("utf8");
  assert.match(replay, /PREVIOUS TASK OUTPUT/, "the history survived the restart");
  assert.match(replay, /session restored/, "with a visible seam");
  assert.match(replay, /live output/, "and new output continues after it");
  evictSeatTty(rig, "coder");
});

test("FRESH spawn CLEARS the mirror — clean eyes stay clean (CE-014)", async () => {
  const rig = mkRig("fresh");
  // No session file: this is a fresh-per-task worker, or a post-refresh respawn.
  seedPane(rig, "coder", "PREVIOUS TASK OUTPUT");
  await spawnStub(rig, "coder");

  const replay = readPaneHistory(rig, "coder").toString("utf8");
  assert.doesNotMatch(replay, /PREVIOUS TASK OUTPUT/,
    "a clean-eyes seat must NOT show the previous task's scrollback");
  assert.doesNotMatch(replay, /session restored/, "and must not claim a restore happened");
  assert.match(replay, /live output/, "the fresh pane still mirrors its own output");
  evictSeatTty(rig, "coder");
});

test("a dropped session.json drops the pane with it (the D12 refresh path, CE-014)", async () => {
  const rig = mkRig("refresh");
  seedSession(rig, "coder");
  seedPane(rig, "coder", "ROUND ONE OUTPUT");
  // The fresh-eyes lever: agentctl / refreshSeat rm's the session file.
  rmSync(sessionFile(rig, "coder"));
  await spawnStub(rig, "coder");
  assert.doesNotMatch(readPaneHistory(rig, "coder").toString("utf8"), /ROUND ONE OUTPUT/);
  evictSeatTty(rig, "coder");
});

test("restored history is parked BEHIND a viewport of padding — a booting TUI's cursor-up repaint cannot reach it (CE-126)", async () => {
  const rig = mkRig("pad");
  seedSession(rig, "coder");
  seedPane(rig, "coder", "PREVIOUS TASK OUTPUT");
  const r = await startSeatTty({
    projectRoot: rig,
    seat: "coder" as never,
    agent: "claude",
    blended: true,
    rows: 7,
    argvOverride: STUB,
  });
  assert.ok(r.ok, `stub spawn failed: ${JSON.stringify(r)}`);
  await new Promise((res) => setTimeout(res, 250));
  const replay = r.ok ? r.tty.replay().toString("utf8") : "";
  const seam = replay.indexOf("session restored");
  const live = replay.indexOf("live output");
  assert.ok(seam >= 0 && live > seam, "history seam precedes live output");
  const between = replay.slice(seam, live);
  assert.ok((between.match(/\r\n/g) ?? []).length >= 7,
    "at least a viewport (rows) of newlines separates the seam from live output — " +
    "cursor-up clamps at the viewport top, so the pad is a wall the boot repaint cannot climb");
  // The pad is RING-ONLY: pane.raw must not accumulate blank runs per restart.
  assert.doesNotMatch(readPaneHistory(rig, "coder").toString("utf8"), /(?:\r\n){7}/,
    "the mirror file carries history + banner + live output, never the replay padding");
  evictSeatTty(rig, "coder");
});

test("the mirror is written for blended seats so the NEXT process can repaint (CE-014)", async () => {
  const rig = mkRig("mirror");
  seedSession(rig, "coder");
  await spawnStub(rig, "coder");
  assert.ok(existsSync(pane(rig, "coder")), "the mirror exists on disk, not just in memory");
  assert.match(readFileSync(pane(rig, "coder"), "utf8"), /live output/);
  evictSeatTty(rig, "coder");
});

// ── the hazard this build introduced, and closed ────────────────────────────
test("attach ignores /state/turns/ — pane.raw must never be committable (CE-014)", () => {
  const src = readFileSync(join(ROOT, "core", "src", "attach.ts"), "utf8");
  const block = /const GI_BLOCK = `([\s\S]*?)`;/.exec(src)?.[1] ?? "";
  assert.match(block, /^\/state\/turns\/$/m,
    "pane.raw is up to ~4MB of raw ANSI per seat; turns/ was NOT ignored before this build, " +
    "leaving a rig one `git add -A` from committing a seat's whole terminal history");
});

// ── the exposure closes on EXISTING rigs, not just re-attached ones ─────────
// attach's managed block now ignores /state/turns/, but that only reaches a rig
// when attach RE-RUNS there — and the engine starts writing pane.raw the moment
// it updates. So the directory ignores itself: `turns/.gitignore` with `*`.
test("turnsDir makes state/turns/ self-ignoring on first touch (CE-014)", () => {
  const rig = mkRig("selfignore");
  const gi = join(rig, ".agents", "state", "turns", ".gitignore");
  assert.ok(!existsSync(gi), "nothing there before the first seat touch");
  turnsDir(rig, "coder");
  assert.ok(existsSync(gi), "one seat touch is enough — no operator action, no re-attach");
  const body = readFileSync(gi, "utf8");
  assert.match(body, /^\*$/m, "the whole directory is ignored");
  assert.match(body, /pane\.raw/, "and it says what it is protecting");
});

test("turnsDir never clobbers an existing turns/.gitignore (CE-014)", () => {
  const rig = mkRig("noclobber");
  const parent = join(rig, ".agents", "state", "turns");
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, ".gitignore"), "# hand-written by the operator\n*\n");
  turnsDir(rig, "coder");
  assert.match(readFileSync(join(parent, ".gitignore"), "utf8"), /hand-written by the operator/,
    "an existing file is left exactly as the operator wrote it");
});

test("a real rig git-ignores pane.raw after one seat touch (CE-014)", () => {
  const rig = mkRig("gitcheck");
  execFileSync("git", ["init", "-q", "."], { cwd: rig });
  turnsDir(rig, "coder");
  writeFileSync(join(rig, ".agents", "state", "turns", "coder", "pane.raw"), "ANSI".repeat(100));
  // git itself is the judge — not our reading of our own rule.
  const out = execFileSync("git", ["status", "--porcelain", "--", ".agents/state/turns"], {
    cwd: rig, encoding: "utf8",
  });
  assert.equal(out.trim(), "", "git sees NOTHING to commit under turns/ — the 4MB blob cannot be added");
});
