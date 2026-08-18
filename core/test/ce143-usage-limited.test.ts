// CE-143 — a seat whose MODEL refuses is invisibly dead.
//
// Live on Adam's own account 2026-08-18: the orchestrator's pane carried
// "You've reached your Fable 5 limit…", the seat then did nothing for nine
// minutes, and the engine reported booted: true, all five seats alive: true,
// delivery "verified in 254ms" — because the mail genuinely landed; the model
// never acted on it. Every process-shaped check was green, correctly, because
// the process WAS alive. Liveness has to mean usable, not running.
//
// The cure reads the pane's TAIL: silence is the detector, the banner only
// names the cause. The false-positive test below is the load-bearing one.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_STALE_RE,
  PANE_TAIL_CHARS,
  USAGE_LIMIT_RE,
  makeAutoReviver,
  normalizePaneText,
  paneUsability,
  type Liveness,
  type SeatHealth,
} from "../src/health.js";

/** The banner Adam actually hit, verbatim from the ledger. */
const FABLE_LIMIT = "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.";

test("the exact banner from the live incident is recognised", () => {
  const v = paneUsability(`working…\ndone\n${FABLE_LIMIT}\n`);
  assert.equal(v?.liveness, "usage-limited");
  assert.match(v!.detail, /usage\/quota limit/);
  assert.match(v!.detail, /alive but cannot work/, "the detail must say the process is fine and the seat still isn't");
});

test("other harnesses' refusal shapes are covered too", () => {
  for (const banner of [
    "Error: usage limit reached for this plan",
    "You are out of credits — add more to continue",
    "google.api_core.exceptions.ResourceExhausted: 429 RESOURCE_EXHAUSTED",
    "Quota exceeded for quota metric 'Generate requests'",
  ]) {
    assert.equal(paneUsability(`some work\n${banner}\n`)?.liveness, "usage-limited", banner);
  }
});

// ── the false positive this design exists to avoid ──────────────────────────

test("a WORKING seat that merely DISCUSSES usage limits is not flagged", () => {
  // A seat reviewing rate-limit code, or writing an error message, will have
  // these words in its pane. A whole-pane scan would call it usage-limited and
  // the operator would go chasing a quota that is perfectly fine. Because the
  // seat kept working, the banner falls out of the tail — which is the entire
  // reason the scan is tail-only.
  const discussed = `I'm adding handling for when the API says "usage limit reached".\n`;
  const kept_working = "x".repeat(PANE_TAIL_CHARS) + "\nedited src/api.ts\nran tests: 42 passing\n";
  assert.equal(paneUsability(discussed + kept_working), undefined);
});

test("…but the SAME text at the end of a stalled pane IS flagged", () => {
  // Same words, different position. This pins the tail as the discriminator so
  // nobody later "simplifies" the scan to the whole buffer.
  const stalled = "x".repeat(PANE_TAIL_CHARS) + `\nI'm adding handling for when the API says "usage limit reached".\n`;
  assert.equal(paneUsability(stalled)?.liveness, "usage-limited");
});

test("an empty or absent pane is never a verdict", () => {
  assert.equal(paneUsability(undefined), undefined);
  assert.equal(paneUsability(""), undefined);
  assert.equal(paneUsability("just ordinary work\n"), undefined);
});

// ── the pane is raw ANSI ────────────────────────────────────────────────────

test("kitty graphics, OSC and CSI are stripped — in that order — before matching", () => {
  // Strip order matters: the kitty payload is base64 that can itself contain
  // sequence-looking bytes, so stripping CSI first leaves noise behind that can
  // swallow the surrounding text. This is the documented pane-decoding lesson.
  const raw =
    "\x1b_Ga=T,f=100;iVBORw0KGgoAAAANSUhEUg\x1b\\" + // kitty image payload
    "\x1b]0;seat title\x07" + // OSC title
    "\x1b[1m\x1b[32m" + FABLE_LIMIT + "\x1b[0m\r\n"; // CSI colour
  const clean = normalizePaneText(raw);
  assert.ok(!clean.includes("\x1b"), "no escapes survive");
  assert.ok(!clean.includes("iVBORw0KGgo"), "the kitty base64 payload is gone, not left as noise");
  assert.ok(clean.includes(FABLE_LIMIT));
  assert.equal(paneUsability(Buffer.from(raw))?.liveness, "usage-limited", "matches through raw ANSI, from a Buffer");
});

// ── the dormant auth-stale detector, now actually wired ─────────────────────

test("run #12's auth-stale markers finally have a consumer", () => {
  // AUTH_STALE_RE existed since run #12 and was exported, never called — a
  // written-but-unwired detector. Same mechanism, so the same scanner decides it.
  const v = paneUsability("...\nAPI Error: 401\n");
  assert.equal(v?.liveness, "signed-out");
  assert.match(v!.detail, /relaunch/, "an in-session /login does not recover it — the detail must say so");
  assert.ok(AUTH_STALE_RE.test("OAuth token has expired"));
});

test("a usage limit outranks an auth marker — the operator's action differs", () => {
  // Topping up vs relaunching are different fixes; if both appear, the newer
  // refusal is the one blocking work.
  assert.equal(paneUsability(`API Error: 401\n${FABLE_LIMIT}\n`)?.liveness, "usage-limited");
});

// ── auto-revive must never fight a quota ────────────────────────────────────

test("a usage-limited seat is NEVER auto-revived", async () => {
  // Relaunching cannot refill a plan: it would respawn straight into the same
  // refusal, on a backoff loop, burning the revive ceiling for nothing.
  const revived: string[] = [];
  const reviver = makeAutoReviver({ revive: async (seat) => { revived.push(seat); } });
  const seat = (liveness: Liveness): SeatHealth => ({
    seat: "coder", title: "Coder", agent: "claude", model: "fable", liveness, detail: "",
  });
  await reviver.tick([seat("usage-limited")], "ws");
  assert.deepEqual(revived, [], "a spent quota is not a crash");
  await reviver.tick([seat("signed-out")], "ws");
  assert.deepEqual(revived, [], "nor is a stale token");
  await reviver.tick([seat("dead")], "ws");
  assert.deepEqual(revived, ["coder"], "…while a genuinely dead seat still revives");
});

test("USAGE_LIMIT_RE is anchored enough not to match ordinary prose", () => {
  for (const innocent of [
    "the rate limiter returns 429 on burst",
    "we should limit the number of retries",
    "usage: crate open <path>",
    "credits: see CONTRIBUTORS.md",
  ]) {
    assert.equal(USAGE_LIMIT_RE.test(innocent), false, innocent);
  }
});

// ── end to end, through the real /api/health route ─────────────────────────
// The unit tests above prove the policy. This proves the WIRING: that a live
// seat's pane actually reaches that policy on the route the cockpit reads.
// Without it, a correct scanner that nothing calls would still ship a green
// cockpit over a dead team — which is precisely the CE-143 failure.

test("/api/health reports a live-but-limited seat as usage-limited, not live", async () => {
  const { startGuiServer } = await import("../src/gui/server.js");
  const { teamProcessFor } = await import("../src/gui/teamproc.js");
  const { turnsDir } = await import("../src/runner.js");
  const { spawn } = await import("node:child_process");
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const home = mkdtempSync(join(tmpdir(), "ce143-home-"));
  const project = mkdtempSync(join(tmpdir(), "ce143-proj-"));
  mkdirSync(join(project, ".agents", "bin"), { recursive: true }); // the server's "is this attached?" check
  writeFileSync(join(project, ".agents", "rig.conf"), 'PROJECT="p"\n');

  // Boot with a stub spawner so seats are genuinely ALIVE without staffing a
  // real agent — aliveness is the precondition the bug hides behind.
  const tp = teamProcessFor(project, () => spawn("sleep", ["30"], { stdio: "ignore" }), undefined, home);
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    tp.boot();
    // One seat's pane ends on the refusal; another is working normally.
    writeFileSync(join(turnsDir(project, "orchestrator"), "pane.raw"), `\x1b[32mthinking\x1b[0m\r\n${FABLE_LIMIT}\r\n`);
    writeFileSync(join(turnsDir(project, "coder"), "pane.raw"), "\x1b[32mran tests: 42 passing\x1b[0m\r\n");

    server = await startGuiServer({ home, project });
    const r = await fetch(`http://127.0.0.1:${server.port}/api/health`, { headers: { "X-Crate-Token": server.token } });
    const body = (await r.json()) as { seats: Array<{ seat: string; liveness: string; detail: string }> };

    const orch = body.seats.find((s) => s.seat === "orchestrator")!;
    const coder = body.seats.find((s) => s.seat === "coder")!;
    assert.equal(orch.liveness, "usage-limited", "the stalled seat must NOT read live — this is the whole bug");
    assert.match(orch.detail, /usage\/quota limit/);
    assert.equal(coder.liveness, "live", "a working seat is untouched");
  } finally {
    tp.stop();
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
