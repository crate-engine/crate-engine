import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sessionFile } from "../src/runner.js";
import { refreshSeat, stateIsFresh } from "../src/refresh.js";

// PHASE-8 T4 (D12): the impeccable-context law. A refresh (session swap) is
// REFUSED while the seat's state file is stale relative to its last turn —
// forcing the state write FIRST so the fresh session picks up correctly.

const scratch = mkdtempSync(join(tmpdir(), "crate2-refresh-"));

function makeSeat(name: string, opts: { stateOlder?: boolean; hasSession?: boolean; midTurn?: boolean } = {}): string {
  const proj = join(scratch, name);
  const turns = join(proj, ".agents", "state", "turns", "reviewer");
  mkdirSync(turns, { recursive: true });
  mkdirSync(join(proj, ".agents", "state"), { recursive: true });
  // the newest turn started 60s ago; meta carries startedAt (unless midTurn)
  const startIso = new Date(Date.now() - 60_000).toISOString();
  const turnFile = join(turns, startIso.replaceAll(":", "-") + ".jsonl");
  writeFileSync(turnFile, opts.midTurn
    ? `{"type":"tool_execution_start","toolName":"read"}\n` // no meta line = running
    : `{"turnMeta":true,"ok":true,"startedAt":"${startIso}"}\n`);
  const stateFile = join(proj, ".agents", "state", "reviewer.md");
  writeFileSync(stateFile, "# Reviewer State\nStatus: idle\n");
  const nowS = Date.now() / 1000;
  const startS = (Date.now() - 60_000) / 1000;
  // stale = state written BEFORE the turn started; fresh = written during/after
  utimesSync(stateFile, opts.stateOlder ? startS - 30 : nowS, opts.stateOlder ? startS - 30 : nowS);
  if (opts.hasSession) writeFileSync(sessionFile(proj, "reviewer"), JSON.stringify({ agent: "pi", sessionId: "s1" }));
  return proj;
}

test("stateIsFresh: fresh when state written during/after the turn; stale when it predates the turn start", () => {
  assert.equal(stateIsFresh(makeSeat("fresh"), "reviewer"), true);
  assert.equal(stateIsFresh(makeSeat("stale", { stateOlder: true }), "reviewer"), false);
});

test("stateIsFresh: NOT fresh mid-turn (a running turn has no meta line)", () => {
  assert.equal(stateIsFresh(makeSeat("running", { midTurn: true }), "reviewer"), false);
});

test("refreshSeat REFUSES on stale state (the impeccable-context law)", () => {
  const proj = makeSeat("refuse", { stateOlder: true, hasSession: true });
  const r = refreshSeat(proj, "reviewer");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /stale|state/i);
  assert.ok(existsSync(sessionFile(proj, "reviewer")), "session must NOT be dropped on a refused refresh");
});

test("refreshSeat SUCCEEDS on fresh state: the session is dropped (next turn starts fresh)", () => {
  const proj = makeSeat("ok", { hasSession: true });
  assert.ok(existsSync(sessionFile(proj, "reviewer")));
  const r = refreshSeat(proj, "reviewer");
  assert.equal(r.ok, true);
  assert.equal(existsSync(sessionFile(proj, "reviewer")), false, "session dropped → fresh re-orient next turn");
});

test("refreshSeat --force overrides the freshness refusal", () => {
  const proj = makeSeat("force", { stateOlder: true, hasSession: true });
  const r = refreshSeat(proj, "reviewer", { force: true });
  assert.equal(r.ok, true);
  assert.equal(existsSync(sessionFile(proj, "reviewer")), false);
});
