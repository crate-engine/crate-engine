// CE-152 — a blended `agy` seat ran with its approvals ON.
//
// Battle test rung B4, the pivot: "can the seat actually BUILD?" The answer was
// no, and not for the reason B4 predicted. A two-file edit brief was delivered to
// a live blended agy coder; it verified on disk in 1006ms, the seat oriented, it
// opened its role binder — and stopped on agy's own approval modal, rendered into
// a pane where nothing can answer it:
//
//   ● Read(~/Projects/battle-test-rig/.agents/config/coder.md)
//   File access
//   Read: /Users/adamduguay/.crate/engine/config/coder.md
//   Reason: outside workspace
//   Allow access to this file?   > 1. Yes  2. Yes, always  3. No
//
// `.agents/config/` symlinks into `~/.crate/engine/config/`, so a seat's own laws
// are "outside workspace" to agy. Every agy seat, every fresh session, blocked at
// the first thing it is told to do — while the engine reported it live, because
// it was: waiting on input is not silence, so no watchdog fires either.
//
// The flag existed. `turn.ts` has `if (walled) argv.push("--dangerously-skip-
// permissions")` on the HEADLESS path, and the claude case in this same builder
// has its walled-only `--permission-mode bypassPermissions`. The agy case just
// never consulted the `walled` it was already handed. That is CE-141's shape
// again: correct on the headless path, missing on the blended one that runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInteractiveInvocation } from "../src/ptyseat.js";

test("a WALLED agy seat auto-approves — this is CE-152", () => {
  const argv = buildInteractiveInvocation("agy", { walled: true, seat: "coder" });
  assert.ok(
    argv.includes("--dangerously-skip-permissions"),
    "a walled agy seat blocks on its own approval modal reading its role binder",
  );
});

test("an UNWALLED agy seat does NOT — approvals are bypassed only inside a wall", () => {
  // The half that keeps the P8 posture honest. Bypassing approvals on a bare
  // host is the thing the walling law exists to prevent, and a fix that bought
  // B4 by dropping that would be a worse bug than the one it cured.
  const argv = buildInteractiveInvocation("agy", { walled: false, seat: "coder" });
  assert.ok(!argv.includes("--dangerously-skip-permissions"));
  assert.ok(!argv.includes("--sandbox"), "the engine renders the wall; agy's own sandbox is never used");
});

test("the flag rides ALONGSIDE model and resume, not instead of them", () => {
  const argv = buildInteractiveInvocation("agy", { walled: true, model: "gemini-3-pro", sessionId: "conv-123" });
  assert.deepEqual(argv, ["agy", "--dangerously-skip-permissions", "--model", "gemini-3-pro", "--conversation", "conv-123"]);
});

test("claude's equivalent is unchanged in both directions", () => {
  // Parity is the whole argument for the cure, so it is asserted rather than
  // assumed — if claude's gate ever moves, this fails next to agy's.
  assert.ok(buildInteractiveInvocation("claude", { walled: true }).includes("bypassPermissions"));
  assert.ok(!buildInteractiveInvocation("claude", { walled: false }).includes("bypassPermissions"));
});

test("every blended CLI that can be walled bypasses its approvals when it is", () => {
  // The drift guard. agy shipped as a blended seat with no approval handling at
  // all and nobody noticed until a seat sat on a modal for real. A new harness
  // added to the interactive door must answer this question explicitly: either
  // it bypasses inside the wall, or it is listed here with the reason it does
  // not need to.
  const NO_BYPASS_NEEDED: Record<string, string> = {
    // pi takes its permissions from its own config and has never prompted in a
    // seat; if that changes it belongs above, not here.
    pi: "no interactive approval prompt observed in a seat",
    // codex was the gap this guard found on the day it was written (CE-153).
    // It is FIXED now, so it must NOT be listed here — if it reappears in this
    // map, someone has regressed the flag and papered over the guard.
  };
  for (const cli of ["claude", "codex", "agy", "pi"]) {
    const walled = buildInteractiveInvocation(cli, { walled: true, seat: "coder" }).join(" ");
    const bypasses = /skip-permissions|bypassPermissions|bypass-approvals|--yolo|--full-auto/.test(walled);
    if (bypasses) continue;
    assert.ok(
      cli in NO_BYPASS_NEEDED,
      `${cli} runs walled with its approvals ON and is not listed as exempt — CE-152 was exactly this`,
    );
  }
});

// ── CE-153: the gap this file's guard found on the day it was written ────────

test("a WALLED codex seat bypasses its approvals — CE-153", () => {
  // The catalog row has always promised this ("Codex's own approvals bypassed
  // within it, same posture as Claude") and turn.ts delivered it headlessly.
  // The blended pane IS the session now, so the promise lived on the path that
  // stopped running. Adam's ruling 2026-08-18 makes it the standing posture.
  assert.deepEqual(buildInteractiveInvocation("codex", { walled: true }), [
    "codex",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
});

test("codex's flag sits AHEAD of the session id, never after it", () => {
  // Placement checked against `codex resume --help`, which lists the flag among
  // the SUBCOMMAND's options. `codex resume [OPTIONS] [SESSION_ID] [PROMPT]` —
  // a flag appended after the id risks being read as the trailing PROMPT.
  assert.deepEqual(buildInteractiveInvocation("codex", { walled: true, sessionId: "thr-9", model: "gpt-5.5" }), [
    "codex",
    "resume",
    "--dangerously-bypass-approvals-and-sandbox",
    "thr-9",
    "--model",
    "gpt-5.5",
  ]);
});

test("an UNWALLED codex seat does NOT bypass — the P8 law is untouched", () => {
  // Adam's ruling is "approvals off"; the wall is what makes that safe. Bypassing
  // on a bare host is the thing the walling law exists to prevent, and the ruling
  // did not change it.
  assert.deepEqual(buildInteractiveInvocation("codex", { walled: false, sessionId: "thr-9" }), ["codex", "resume", "thr-9"]);
});

test("pi stays exempt for a TRUE reason, not a convenient one", () => {
  // `pi --approve/-a` trusts project-local FILES for a run — it is not a tool
  // approvals switch. There is no flag to pass, so Adam's ruling cannot be
  // expressed for pi as an argv change. If pi ever grows one, the guard above
  // starts failing and that is the intended prompt to revisit this.
  assert.deepEqual(buildInteractiveInvocation("pi", { walled: true }), ["pi"]);
});
