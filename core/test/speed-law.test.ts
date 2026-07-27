// SPEED LAW (overnight 2026-07-14) — the agent-agnostic loop-overhead cuts,
// measured from the testuser8 turn logs (15 orchestrator relay turns ≈ 11 of
// the run's 21 minutes; ~25 output tokens each):
//   1. resumed sessions get a SLIM turn prompt (no re-orientation tool trips)
//   2. runners wake on fs.watch, not the 1s poll; stop/abort is instant
//   3. turns.log carries wait= (handoff latency) — regressions are visible
// The code_ready fan-out (parallel review+QA, no relay turn) is pinned in
// concurrent-loops.test.ts; the merge-go direct route in teamctl behavior.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enqueue, readNew } from "../src/mailbox.js";
import { runTurn, runnerLoop } from "../src/runner.js";
import { composeTurnPrompt } from "../src/turn.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-speed-"));

function makeProject(name: string): string {
  const proj = join(scratch, name);
  mkdirSync(join(proj, ".agents", "state", "inbox"), { recursive: true });
  mkdirSync(join(proj, ".agents", "config"), { recursive: true });
  writeFileSync(join(proj, ".agents", "config", "reviewer.md"), "# binder");
  return proj;
}

function stub(proj: string, name: string, script: string): string {
  const p = join(proj, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${script}`);
  chmodSync(p, 0o755);
  return p;
}

const okStream = (sid: string) =>
  `echo '{"type":"result","subtype":"success","result":"done","session_id":"${sid}","usage":{"input_tokens":10,"output_tokens":5}}'\n`;

test("composeTurnPrompt: a resumed session gets the SLIM prompt — no re-orientation, rails intact", () => {
  const proj = makeProject("slim");
  writeFileSync(join(proj, "AGENTS.md"), "# agents");
  const mail = [{ at: "2026-07-14T01:00:00Z", from: "coder", body: "[CODE_READY] branch=x" } as never];
  const full = composeTurnPrompt(proj, "reviewer", mail);
  const slim = composeTurnPrompt(proj, "reviewer", mail, { resumed: true });
  assert.match(full, /Orient first/);
  assert.match(slim, /resumed session/);
  assert.doesNotMatch(slim, /Orient first/, "no re-orientation pass on a live session");
  assert.match(slim, /coder: \[CODE_READY\] branch=x/, "mail rides the slim prompt");
  assert.match(slim, /state\/reviewer\.md/, "freshness rail survives");
  assert.match(slim, /never send an ack-only reply/i, "ack rail survives");
  assert.ok(slim.length < full.length * 0.75, "slim is materially smaller");
});

test("runTurn: first turn orients FULL; the next turn on the same live session is SLIM", async () => {
  const proj = makeProject("resume");
  const inbox = join(proj, ".agents", "state", "inbox");
  const bin = stub(proj, "fake.sh", okStream("sess-9"));
  const prompts: string[] = [];
  const opts = {
    projectRoot: proj, seat: "reviewer", agent: "claude",
    invocationOverride: (prompt: string) => {
      prompts.push(prompt);
      return { argv: [bin], stdin: "ignore" as const };
    },
  };
  enqueue(inbox, "reviewer", "orchestrator", "first work order");
  assert.equal((await runTurn(opts)).ok, true);
  enqueue(inbox, "reviewer", "orchestrator", "second work order");
  assert.equal((await runTurn(opts)).ok, true);
  assert.match(prompts[0]!, /Orient first/, "turn 1 = full orientation");
  assert.match(prompts[1]!, /resumed session/, "turn 2 = slim (session live)");
  const log = readFileSync(join(proj, ".agents", "state", "turns", "reviewer", "turns.log"), "utf8");
  const lines = log.trim().split("\n");
  assert.match(lines[0]!, / \| wait=\d+ms \| oriented/, "turn 1 logs handoff wait + oriented marker");
  assert.match(lines[1]!, / \| wait=\d+ms/, "turn 2 logs handoff wait");
  assert.doesNotMatch(lines[1]!, /oriented/, "turn 2 is not an orientation turn");
});

test("runnerLoop: fs.watch wakes the seat the instant mail lands (poll set far beyond test time); abort is instant", async () => {
  const proj = makeProject("watch");
  const inbox = join(proj, ".agents", "state", "inbox");
  const bin = stub(proj, "fake.sh", okStream("sess-w"));
  const ac = new AbortController();
  const loop = runnerLoop({
    projectRoot: proj, seat: "reviewer", agent: "claude",
    pollMs: 60_000, // only the watcher (or abort) can wake us inside the test window
    signal: ac.signal,
    invocationOverride: () => ({ argv: [bin], stdin: "ignore" as const }),
  });
  await new Promise((r) => setTimeout(r, 300)); // loop is idle-waiting on the watcher
  enqueue(inbox, "reviewer", "orchestrator", "wake up");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && readNew(inbox, "reviewer").length > 0) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(readNew(inbox, "reviewer").length, 0, "mail consumed via watch wake, not the 60s poll");
  const t0 = Date.now();
  ac.abort();
  await loop;
  assert.ok(Date.now() - t0 < 2_000, "abort exits the loop instantly, not poll-bounded");
});
