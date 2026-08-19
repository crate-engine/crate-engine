// CE-148 — `agy` was offered READY in the staffing catalog on a marker alone.
//
// Found by the battle test (docs/manual/battle-test.md, rung A2) on 2026-08-18,
// the day after the agy seat shipped. The detection was never wrong: detect.ts
// says in its own comment that agy's onboarding marker "MAY NEVER, ON ITS OWN,
// MEAN READY" — agy keeps its credential in the OS KEYRING, so there is no
// dotfile to stat the way gemini had oauth_creds.json — and it provides the
// positive proof as a deep probe (`agy models`).
//
// Nothing on the staffing surface called it. `staffingCatalog` composed
// `agentProblem(...) ?? cachedDeepClaudeProblem(...)`, and that cache opened with
// `if (agent !== "claude") return undefined`. So claude got the backstop its own
// scar had earned it (Flaw 4, 2026-08-10: a leftover ~/.claude.json from an old
// install false-READYs a machine whose credential is gone) and every other agent
// got the marker's optimism. Reproduced live: a HOME whose onboarding.json says
// onboardingComplete plus an `agy` that exits non-zero answered /api/staffing
// with `agy ready:true`. The operator picks a green row and gets a dead seat —
// which is CE-138, and CE-138 wedged a live seat.
//
// The cure is one enrollment list, DEEP_PROBED, read by both detect.ts and the
// catalog. The load-bearing test here is the DRIFT GUARD: it reads detect.ts and
// fails if a deep branch ever exists for an agent the list does not carry,
// because "someone added a probe and forgot the surface" is precisely how this
// happened once already.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEP_PROBED, agentProblem } from "../src/detect.js";

/** A HOME that has onboarded agy once — the marker the bug trusted. */
function agyMarkerHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ce148-home-"));
  const cache = join(home, ".gemini", "antigravity-cli", "cache");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "onboarding.json"), JSON.stringify({ onboardingComplete: true }));
  return home;
}

/** A PATH dir holding an `agy` that behaves as the named exit code — a dead
 * keyring credential is indistinguishable from this at the process boundary. */
function agyBin(exitCode: number, stdout = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "ce148-bin-"));
  const bin = join(dir, "agy");
  writeFileSync(bin, `#!/bin/sh\n${stdout ? `printf '%s' ${JSON.stringify(stdout)}\n` : ""}exit ${exitCode}\n`);
  chmodSync(bin, 0o755);
  return dir;
}

// ── the drift guard: the list and the probes cannot disagree ────────────────

test("every agent with a deep probe is enrolled in DEEP_PROBED", () => {
  // CE-148 in one assertion. detect.ts gates each deep probe on
  // `opts.deep && agent === "<name>"`; every name that appears there must be in
  // the list the staffing surface consults, or that agent is judged on its
  // marker alone exactly as agy was.
  const src = readFileSync(new URL("../src/detect.ts", import.meta.url), "utf8");
  const probed = new Set<string>();
  for (const m of src.matchAll(/opts\.deep\s*&&\s*\(?([^)]*?)\)?\s*\)\s*\{/g)) {
    for (const n of m[1]!.matchAll(/agent === "([^"]+)"/g)) probed.add(n[1]!);
  }
  assert.ok(probed.size >= 2, `the scan found ${probed.size} deep branches — the regex has drifted from the source`);
  const missing = [...probed].filter((a) => !DEEP_PROBED.includes(a));
  assert.deepEqual(missing, [], `these agents have a deep probe nothing enrolls: ${missing.join(", ")}`);
});

test("DEEP_PROBED carries agy — the agent the bug was about", () => {
  assert.ok(DEEP_PROBED.includes("agy"));
  assert.ok(DEEP_PROBED.includes("claude"), "claude's own Flaw-4 backstop must not have been lost in the generalisation");
});

// ── the two directions of the marker, unchanged ─────────────────────────────

test("marker ABSENT is a cheap NOT-ready that never pays for a probe", () => {
  const home = mkdtempSync(join(tmpdir(), "ce148-bare-"));
  // An `agy` that would SUCCEED if asked. The marker check runs first and short
  // circuits, so a signed-out machine never pays the network cost — that
  // ordering is what makes a per-30s re-ask on a PROBLEM affordable.
  const dir = agyBin(0, "gemini-3-pro\n");
  try {
    const p = agentProblem("agy", home, [""], { path: dir, deep: true });
    assert.match(p!.fix, /installed but not signed in/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("marker PRESENT + dead credential: shallow says READY, deep tells the truth", () => {
  const home = agyMarkerHome();
  const dir = agyBin(7);
  try {
    assert.equal(
      agentProblem("agy", home, [""], { path: dir }),
      undefined,
      "shallow READY on the marker alone is the DESIGNED optimism — the bug was trusting it on the staffing surface",
    );
    const deep = agentProblem("agy", home, [""], { path: dir, deep: true });
    assert.match(deep!.fix, /saved sign-in isn't usable right now/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deep probe that only prints its spinner is NOT a credential", () => {
  // `agy models` prints "Fetching available models..." before it knows whether
  // it can authenticate. Counting that as output would be a false READY of
  // exactly the CE-138 shape, so the probe strips it before testing for content.
  const home = agyMarkerHome();
  const dir = agyBin(0, "Fetching available models...");
  try {
    const deep = agentProblem("agy", home, [""], { path: dir, deep: true });
    assert.ok(deep !== undefined, "spinner-only output must not read as a live credential");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deep probe that hangs is a NOT-ready, not a wedged server", () => {
  // The catalog runs this on a request path in a single-threaded server, so the
  // ceiling is the product decision: a timeout resolves to the safe direction
  // (NOT-ready — the operator re-checks) rather than blocking every other route.
  const home = agyMarkerHome();
  const dir = mkdtempSync(join(tmpdir(), "ce148-hang-"));
  writeFileSync(join(dir, "agy"), "#!/bin/sh\nsleep 30\n");
  chmodSync(join(dir, "agy"), 0o755);
  try {
    const started = Date.now();
    const deep = agentProblem("agy", home, [""], { path: dir, deep: true, deepTimeoutMs: 600 });
    const elapsed = Date.now() - started;
    assert.ok(deep !== undefined, "a hung probe must not read as READY");
    assert.ok(elapsed < 10_000, `the ceiling was not honoured (${elapsed}ms)`);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── end to end: the surface that staffs a seat ──────────────────────────────

test("END TO END: /api/staffing refuses to offer agy on a dead credential", async () => {
  // The rung that failed. A cache nothing consults would still ship a green
  // picker over a dead harness, so this asks the real route on a real server —
  // the same reason CE-143's suite carries an end-to-end /api/health test.
  const { startGuiServer } = await import("../src/gui/server.js");
  const home = agyMarkerHome();
  const dir = agyBin(7);
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home, detectPath: dir });
    const r = await fetch(`http://127.0.0.1:${server.port}/api/staffing`, {
      headers: { "X-Crate-Token": server.token },
    });
    const body = (await r.json()) as { models: Array<{ agent: string; ready: boolean; fix?: string }> };
    const agy = body.models.filter((m) => m.agent === "agy");
    assert.ok(agy.length > 0, "agy must still be LISTED — the cure is honesty, not hiding the row");
    for (const row of agy) {
      assert.equal(row.ready, false, "this is CE-148: a dead keyring credential was offered as READY");
      assert.match(row.fix!, /saved sign-in isn't usable right now/, "the row must say what to do about it");
    }
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("END TO END: a LIVE agy credential is still offered", async () => {
  // The other direction, and the one a too-eager fix breaks: if the probe were
  // wrong in the NOT-ready direction, the newest harness would be unstaffable
  // and nobody would notice from the failing test above.
  const { startGuiServer } = await import("../src/gui/server.js");
  const home = agyMarkerHome();
  const dir = agyBin(0, "gemini-3-pro\nclaude-opus-4-6-thinking\n");
  let server: Awaited<ReturnType<typeof startGuiServer>> | undefined;
  try {
    server = await startGuiServer({ home, detectPath: dir });
    const r = await fetch(`http://127.0.0.1:${server.port}/api/staffing`, {
      headers: { "X-Crate-Token": server.token },
    });
    const body = (await r.json()) as { models: Array<{ agent: string; ready: boolean }> };
    const agy = body.models.filter((m) => m.agent === "agy");
    assert.ok(agy.length > 0);
    for (const row of agy) assert.equal(row.ready, true, "a working credential must still staff");
  } finally {
    server?.server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
