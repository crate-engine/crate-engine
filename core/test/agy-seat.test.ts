// The `agy` seat — Antigravity CLI wired as a first-class harness (2026-08-18).
//
// Context: Google retired Gemini CLI for EVERY consumer tier on 2026-06-18, so
// the `gemini` wire is permanently unusable on a personal account (CE-138's
// correction). `agy` is Google's sanctioned replacement and the only route to
// Gemini models on a consumer subscription. Design: dev/pdr/agy-antigravity-seat.md
//
// The stream fixtures here are CAPTURED FROM A REAL RUN (fixtures/agy/), not
// hand-written — the PDR insists on that because the published docs were wrong
// about the tier story and silent about the wall behaviour, and a hand-written
// fixture would have encoded whatever I assumed rather than what agy emits.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { agentProblem, binaryFor, seatAuthProblem } from "../src/detect.js";
import {
  CLI_DELIVERY,
  agyTranscriptsSince,
  assistantTurnStartedAfter,
  blendEligible,
  findBlendSessionCandidates,
  isBlended,
  verifyDelivered,
} from "../src/blend.js";
import { buildInteractiveInvocation } from "../src/ptyseat.js";
import { preseedAgyProjectTrust, renderProfile, renderBwrapArgs, stateDoorsFor } from "../src/sandbox.js";
import { buildHeadlessInvocation, parseSessionId, parseUsage } from "../src/turn.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRAMES = readFileSync(join(ROOT, "core", "test", "fixtures", "agy", "turn.stream-json.ndjson"), "utf8")
  .split("\n")
  .filter((l) => l.trim());

/** A home dir with (or without) the agy onboarding marker. */
function mkHome(onboarded?: boolean): string {
  const home = mkdtempSync(join(tmpdir(), "agy-home-"));
  if (onboarded !== undefined) {
    const dir = join(home, ".gemini", "antigravity-cli", "cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "onboarding.json"), JSON.stringify({ onboardingComplete: onboarded }));
  }
  return home;
}

// ── the wall door — the load-bearing find ───────────────────────────────────
// A walled agy seat writes its conversation store to ~/.gemini/antigravity-cli.
// Without a door those writes fail ("operation not permitted" on seatbelt,
// "read-only file system" on bwrap) while the turn STILL returns SUCCESS with
// full token accounting — so the seat looks healthy and silently loses every
// session (`--conversation <id>` then errors "conversation not found"). Both
// halves were measured live before this door was written.

test("agy gets a state door for its conversation store — without it, sessions vanish silently", () => {
  assert.deepEqual(stateDoorsFor("agy"), ["~/.gemini/antigravity-cli"]);
});

test("the agy door is DIRECTORY-granular — agy renames <file>.<uuid>.tmp into place (CE-129's lesson)", () => {
  const door = stateDoorsFor("agy")[0]!;
  assert.ok(!/\.[a-z]+$/.test(door), `${door} looks file-granular; a rename cannot cross a single-file bind mount`);
});

test("the door reaches BOTH backends — seatbelt profile and bwrap argv", () => {
  const home = mkHome(true);
  const proj = mkdtempSync(join(tmpdir(), "agy-proj-"));
  const out = mkdtempSync(join(tmpdir(), "agy-out-"));
  try {
    const spec = { seat: "coder", sandbox: "standard" as const, doors: stateDoorsFor("agy") };
    const paths = { brainRoot: ROOT, projectRoot: proj, home };

    const profile = renderProfile(spec, paths)!;
    assert.match(profile, /antigravity-cli/, "seatbelt profile carries the door");
    assert.match(profile, new RegExp(`subpath "${home}/\\.gemini/antigravity-cli"`), "expanded to a real subpath");

    const bw = renderBwrapArgs(spec, paths)!;
    const joined = bw.args.join(" ");
    assert.match(joined, /antigravity-cli/, "bwrap argv carries the door");
    assert.ok(!bw.skippedDoors.includes("~/.gemini/antigravity-cli"), "a skipped door is a silently walled-off seat");
    void out;
  } finally {
    for (const d of [home, proj, out]) rmSync(d, { recursive: true, force: true });
  }
});

// ── the turn wire ───────────────────────────────────────────────────────────

test("agy's headless argv matches the surface verified against the shipping binary", () => {
  const { argv, stdin } = buildHeadlessInvocation("agy", { prompt: "do the thing" });
  assert.deepEqual(argv, ["agy", "-p", "do the thing", "--output-format", "stream-json"]);
  assert.equal(stdin, "ignore");
});

test("agy resumes BY ID — the ambiguity that kept the gemini wire stateless", () => {
  const { argv } = buildHeadlessInvocation("agy", { prompt: "p", sessionId: "abc-123", model: "gemini-3.1-pro-high" });
  assert.deepEqual(argv.slice(-4), ["--model", "gemini-3.1-pro-high", "--conversation", "abc-123"]);
});

test("the permission bypass rides ONLY inside a rendered wall", () => {
  const walled = buildHeadlessInvocation("agy", { prompt: "p", walled: true }).argv;
  const bare = buildHeadlessInvocation("agy", { prompt: "p" }).argv;
  assert.ok(walled.includes("--dangerously-skip-permissions"));
  assert.ok(!bare.includes("--dangerously-skip-permissions"), "an unwalled seat must not run fully bypassed");
});

test("we NEVER pass agy's own --sandbox — Seatbelt does not nest inside our wall", () => {
  for (const walled of [true, false]) {
    const { argv } = buildHeadlessInvocation("agy", { prompt: "p", walled });
    assert.ok(!argv.includes("--sandbox"), "agy --sandbox under a crate wall is two Seatbelts deep");
  }
});

// ── frame parsing, against the CAPTURED fixture ─────────────────────────────

test("usage comes from the result frame, where agy nests it (not top-level like claude)", () => {
  const hits = FRAMES.map((l) => parseUsage("agy", l)).filter(Boolean);
  assert.equal(hits.length, 1, "exactly ONE authoritative usage per turn");
  const u = hits[0]!;
  assert.ok(u.inputTokens > 0, "real input tokens off the captured frame");
  assert.ok(u.outputTokens > 0, "real output tokens off the captured frame");
});

test("step_update usage is NOT counted — its deltas would inflate every turn's total", () => {
  const stepFrames = FRAMES.filter((l) => JSON.parse(l).event === "step_update");
  const withUsage = stepFrames.filter((l) => "usage" in JSON.parse(l).step_update);
  assert.ok(withUsage.length > 0, "the fixture really does carry step-level usage (else this test proves nothing)");
  for (const l of withUsage) assert.equal(parseUsage("agy", l), undefined);
});

test("the conversation id is read from the init frame's TOP level", () => {
  const init = FRAMES.find((l) => JSON.parse(l).event === "init")!;
  const id = parseSessionId("agy", init);
  assert.equal(id, JSON.parse(init).conversation_id);
  assert.match(id!, /^[0-9a-f-]{36}$/);
});

test("a truncated stream still yields the id — result carries it nested", () => {
  // Defensive: if init is lost, reading only the top level would return
  // undefined and the next turn would silently start a NEW conversation.
  const result = FRAMES.find((l) => JSON.parse(l).event === "result")!;
  assert.equal(parseSessionId("agy", result), JSON.parse(result).result.conversation_id);
});

test("non-JSON and unrelated frames never throw", () => {
  for (const junk of ["", "not json", "{}", '{"event":"init"}']) {
    assert.equal(parseUsage("agy", junk), undefined);
    assert.doesNotThrow(() => parseSessionId("agy", junk));
  }
});

// ── detection — the CE-048/CE-138 false-READY family ────────────────────────

test("agy is install-detected by its own binary", () => {
  assert.equal(binaryFor("agy"), "agy");
});

test("no onboarding marker = an honest not-signed-in, naming the one command that fixes it", () => {
  const home = mkHome();
  try {
    const p = seatAuthProblem("agy", home);
    assert.ok(p, "absent marker must not read as signed in");
    assert.match(p!.fix, /run `agy`/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an INCOMPLETE onboarding marker is still not signed in", () => {
  const home = mkHome(false);
  try {
    assert.ok(seatAuthProblem("agy", home), "onboardingComplete:false must not pass");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** A fake `agy` on PATH whose `models` call behaves as told. */
function stubAgy(behaviour: "authed" | "refuses"): { bin: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "agy-bin-"));
  const body =
    behaviour === "authed"
      ? '#!/bin/sh\necho "Fetching available models..."\necho "gemini-3.7-flash-high\tGemini 3.7 Flash (High)"\n'
      : '#!/bin/sh\necho "authentication required. Run \'agy\' to log in, then retry." >&2\nexit 1\n';
  const bin = join(dir, "agy");
  writeFileSync(bin, body);
  chmodSync(bin, 0o755);
  return { bin: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the marker alone NEVER produces READY — a refusing credential must not ride it through", () => {
  // The heart of it. The marker says someone onboarded ONCE; it says nothing
  // about whether the keyring credential is live or the tier eligible. That gap
  // IS CE-048 (stale claude markers) and CE-138 (valid-looking, unservable
  // gemini creds that wedged a live seat). So: marker present, binary present,
  // and `agy models` refusing — the shallow pass must NOT survive deep.
  const home = mkHome(true);
  const stub = stubAgy("refuses");
  try {
    assert.equal(seatAuthProblem("agy", home), undefined, "shallow is optimistic, like claude's markers");
    const deep = agentProblem("agy", home, [], { deep: true, path: stub.bin });
    assert.ok(deep, "a refusing probe must report a problem, not inherit the marker's optimism");
    assert.match(deep!.fix, /sign-in|keyring/i, "and it must name the real fix, not 'not installed'");
  } finally {
    stub.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("deep says READY only when a live credential actually answers", () => {
  const home = mkHome(true);
  const stub = stubAgy("authed");
  try {
    assert.equal(agentProblem("agy", home, [], { deep: true, path: stub.bin }), undefined);
  } finally {
    stub.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("an uninstalled agy is reported as uninstalled, not as a sign-in problem", () => {
  const home = mkHome(true);
  try {
    const p = agentProblem("agy", home, [], { deep: true, path: join(home, "nowhere") });
    assert.match(p!.fix, /isn't installed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── blend promotion (probe recipe run 2026-08-18) ───────────────────────────
// agy earned BlendCli through the three probes. The shapes below are the
// probe's own captures, and the trust finding is the one that would have hurt:
// its first-launch modal's default answer EATS the first delivery, which with
// fresh-per-task workers is a lost brief every task, not a one-off.

test("agy is blend-eligible — its pane IS the session, not the headless fallback", () => {
  const e = blendEligible("agy");
  assert.equal(e.ok, true);
  assert.equal((e as { cli: string }).cli, "agy");
});

test("blended by default, and opt-out-able like every other eligible CLI", () => {
  assert.equal(isBlended({}, "coder", "agy"), true);
  assert.equal(isBlended({ BLEND_CODER: "0" }, "coder", "agy"), false);
});

test("delivery timing follows the probe: mid-turn write at ~1s, 120s ceiling", () => {
  const d = CLI_DELIVERY.agy;
  assert.equal(d.submitDelayMs, 1000, "the separate-CR gap the recipe proves out");
  assert.equal(d.verifyTimeoutMs, 120_000);
  assert.ok(d.verifyPollMs <= 1000, "agy writes mid-turn, so polling may be tighter than a turn-end CLI's");
});

test("a delivery is verified against the CAPTURED user-record shape", () => {
  const rec = JSON.stringify({
    type: "USER_INPUT",
    source: "USER_EXPLICIT",
    status: "DONE",
    content: "<USER_REQUEST>\n#abc123 do the thing\n</USER_REQUEST>",
  });
  assert.equal(verifyDelivered(rec, "#abc123", "agy"), true);
});

test("agy's own SYSTEM echoes must NOT satisfy a delivery", () => {
  // The probe showed CHECKPOINT/SYSTEM records quote the user's text verbatim.
  // If those counted, the engine would call a delivery verified that the agent
  // never actually received — delivery verification's whole point, inverted.
  for (const echo of [
    { type: "CHECKPOINT", source: "SYSTEM", content: "{{ CHECKPOINT 0 }} … #abc123 …" },
    { type: "SYSTEM_MESSAGE", source: "SYSTEM", content: "not actually sent by the user … #abc123" },
    { type: "PLANNER_RESPONSE", source: "MODEL", content: "#abc123 received." },
  ]) {
    assert.equal(verifyDelivered(JSON.stringify(echo), "#abc123", "agy"), false, `${echo.type} must not count`);
  }
});

test("an assistant turn after the marker disarms the watchdog — null content never throws", () => {
  // The probe caught PLANNER_RESPONSE records with content: null mid-flight,
  // so the assistant check must not touch content at all.
  const user = JSON.stringify({ type: "USER_INPUT", source: "USER_EXPLICIT", content: "#abc123 go" });
  const live = JSON.stringify({ type: "PLANNER_RESPONSE", source: "MODEL", content: null });
  assert.doesNotThrow(() => assistantTurnStartedAfter(`${user}\n${live}`, "#abc123", "agy"));
  assert.equal(assistantTurnStartedAfter(`${user}\n${live}`, "#abc123", "agy"), true);
  // …and an assistant record BEFORE the marker must not count as attention.
  assert.equal(assistantTurnStartedAfter(`${live}\n${user}`, "#abc123", "agy"), false);
});

test("session discovery reads agy's conversation-keyed transcripts, newest first", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-brain-"));
  try {
    const mk = (conv: string, mtime: number) => {
      const d = join(home, ".gemini", "antigravity-cli", "brain", conv, ".system_generated", "logs");
      mkdirSync(d, { recursive: true });
      const f = join(d, "transcript.jsonl");
      writeFileSync(f, "");
      utimesSync(f, mtime / 1000, mtime / 1000);
      return f;
    };
    const older = mk("11111111-1111-1111-1111-111111111111", Date.now() - 60_000);
    const newer = mk("22222222-2222-2222-2222-222222222222", Date.now() - 1_000);
    const found = agyTranscriptsSince(home, Date.now() - 120_000);
    assert.deepEqual(found, [newer, older], "newest first — the pre-pin fast path");
    assert.deepEqual(agyTranscriptsSince(home, Date.now() - 10_000), [newer], "since-spawn filter holds");
    void older;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the session id is the CONVERSATION dir — every transcript is named the same", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-sid-"));
  try {
    const conv = "abcd-1234";
    const d = join(home, ".gemini", "antigravity-cli", "brain", conv, ".system_generated", "logs");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "transcript.jsonl"), "");
    const [c] = findBlendSessionCandidates("agy", { projectRoot: "/irrelevant", home, sinceMs: Date.now() - 60_000 });
    assert.equal(c?.sessionId, conv, "derived from the directory, not the filename");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("discovery is NOT cwd-scoped for agy — the self-verifying pin is what keeps it safe", () => {
  // agy keys transcripts by conversation, so another project's live session is
  // a legitimate candidate. Documenting that here on purpose: if this ever
  // becomes cwd-filtered, the pin logic and this comment must move together.
  const home = mkdtempSync(join(tmpdir(), "agy-scope-"));
  try {
    const d = join(home, ".gemini", "antigravity-cli", "brain", "other-proj", ".system_generated", "logs");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "transcript.jsonl"), "");
    const cands = findBlendSessionCandidates("agy", { projectRoot: "/some/unrelated/repo", home, sinceMs: Date.now() - 60_000 });
    assert.equal(cands.length, 1, "candidates are machine-wide; verification pins the right one");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── probe 3's finding: the trust modal, and the seed that disarms it ────────

test("trust pre-seed adds the project and is idempotent", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-trust-"));
  try {
    const dir = join(home, ".gemini", "antigravity-cli");
    mkdirSync(dir, { recursive: true });
    const cfg = join(dir, "settings.json");
    writeFileSync(cfg, JSON.stringify({ colorScheme: "tokyo night", trustedWorkspaces: ["/existing"] }));

    assert.equal(preseedAgyProjectTrust(home, "/repo/x"), true, "first seed writes");
    const after = JSON.parse(readFileSync(cfg, "utf8")) as { trustedWorkspaces: string[]; colorScheme: string };
    assert.deepEqual(after.trustedWorkspaces, ["/existing", "/repo/x"], "ADDS — never replaces the operator's list");
    assert.equal(after.colorScheme, "tokyo night", "unrelated settings survive");

    assert.equal(preseedAgyProjectTrust(home, "/repo/x"), false, "already trusted = no rewrite");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a missing or corrupt agy config NEVER blocks the spawn", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-trust2-"));
  try {
    assert.equal(preseedAgyProjectTrust(home, "/repo/x"), false, "no config — seat spawns as before");
    const dir = join(home, ".gemini", "antigravity-cli");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), "{ not json");
    assert.equal(preseedAgyProjectTrust(home, "/repo/x"), false, "corrupt config — still no throw");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the interactive door is plain `agy`, resuming by conversation", () => {
  assert.deepEqual(buildInteractiveInvocation("agy", {}), ["agy"]);
  assert.deepEqual(buildInteractiveInvocation("agy", { model: "gemini-3.7-flash-high", sessionId: "conv-1" }), [
    "agy",
    "--model",
    "gemini-3.7-flash-high",
    "--conversation",
    "conv-1",
  ]);
});

test("the interactive door does NOT carry --add-dir — that is a print-mode wart", () => {
  // agy -p writes "artifacts" into its own scratch and needs --add-dir to touch
  // the project, reporting SUCCESS either way. Interactive agy works on the
  // trusted dir directly, so carrying the flag here would imply a bug we do
  // not have and mask the trust seed being the real mechanism.
  assert.ok(!buildInteractiveInvocation("agy", {}).includes("--add-dir"));
});
