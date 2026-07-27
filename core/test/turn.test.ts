import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildHeadlessInvocation, composeTurnPrompt, parseSessionId, parseUsage } from "../src/turn.js";

// PHASE-8 T1: turn composition + per-adapter headless invocations. The argv
// shapes and parsers are pinned to the T0 CONFIRM evidence
// (dev/plan/proofs/phase-8/t0-adapter-confirms.md) — including the live-found
// quirks: codex needs stdin CLOSED + bypass; claude stream-json needs
// --verbose. Parser fixtures are VERBATIM lines from the T0 runs.

test("pi invocation: -p, json mode, session id rides when present", () => {
  const fresh = buildHeadlessInvocation("pi", { prompt: "go", model: "openai-codex/gpt-5.5" });
  assert.deepEqual(fresh.argv.slice(0, 1), ["pi"]);
  assert.ok(fresh.argv.includes("-p") && fresh.argv.includes("--mode") && fresh.argv.includes("json"));
  assert.ok(!fresh.argv.includes("--session-id"));
  const resumed = buildHeadlessInvocation("pi", { prompt: "go", sessionId: "abc-123" });
  assert.ok(resumed.argv.join(" ").includes("--session-id abc-123"));
  assert.equal(fresh.stdin, "ignore");
});

test("claude invocation: -p stream-json REQUIRES --verbose; --resume rides a session", () => {
  const fresh = buildHeadlessInvocation("claude", { prompt: "go" });
  const line = fresh.argv.join(" ");
  assert.match(line, /--output-format stream-json/);
  assert.match(line, /--verbose/); // the T0 quirk
  const resumed = buildHeadlessInvocation("claude", { prompt: "go", sessionId: "sid-9" });
  assert.match(resumed.argv.join(" "), /--resume sid-9/);
});

test("codex invocation: exec --json + bypass (gated on walled); resume is a subcommand; stdin closed", () => {
  const fresh = buildHeadlessInvocation("codex", { prompt: "go", walled: true });
  const line = fresh.argv.join(" ");
  assert.match(line, /^codex exec --json --dangerously-bypass-approvals-and-sandbox/);
  assert.equal(fresh.stdin, "ignore"); // T0: codex exec reads stdin and hangs otherwise
  const resumed = buildHeadlessInvocation("codex", { prompt: "go", sessionId: "019f5758-51e0", walled: true });
  assert.match(resumed.argv.join(" "), /^codex exec resume 019f5758-51e0 --json/);
  // Defense-in-depth: no wall → no bypass (an unwalled codex would only prompt).
  assert.ok(!buildHeadlessInvocation("codex", { prompt: "go" }).argv.includes("--dangerously-bypass-approvals-and-sandbox"));
});

// ── parsers, against VERBATIM T0 capture lines ──────────────────────────────

const PI_LINE = `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"T0-PI-OK"}],"api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.5","usage":{"input":3614,"output":10,"cacheRead":0,"cacheWrite":0,"reasoning":0,"totalTokens":3624},"stopReason":"stop","timestamp":1783876709687}}`;
const CLAUDE_RESULT = `{"type":"result","subtype":"success","is_error":false,"result":"T0-CLAUDE-OK","session_id":"fbd78f76-2dc4-4090-bfd0-490720f23011","usage":{"input_tokens":2,"output_tokens":91}}`;
const CODEX_THREAD = `{"type":"thread.started","thread_id":"019f5758-0bb0-73a3-97ef-095ac661f776"}`;
const CODEX_USAGE = `{"type":"turn.completed","usage":{"input_tokens":13681,"cached_input_tokens":8960,"output_tokens":11,"reasoning_output_tokens":0}}`;

test("parseUsage: verbatim T0 lines per adapter", () => {
  assert.deepEqual(parseUsage("pi", PI_LINE), { inputTokens: 3614, outputTokens: 10 });
  assert.deepEqual(parseUsage("claude", CLAUDE_RESULT), { inputTokens: 2, outputTokens: 91 });
  assert.deepEqual(parseUsage("codex", CODEX_USAGE), { inputTokens: 13681, outputTokens: 11 });
});

test("parseSessionId: verbatim T0 lines per adapter", () => {
  assert.equal(parseSessionId("claude", CLAUDE_RESULT), "fbd78f76-2dc4-4090-bfd0-490720f23011");
  assert.equal(parseSessionId("codex", CODEX_THREAD), "019f5758-0bb0-73a3-97ef-095ac661f776");
  // pi: the session id is CHOSEN by the runner (--session-id), not parsed.
});

test("composeTurnPrompt: points at the binder + docs (never inlines them) and carries the mail", () => {
  const proj = mkdtempSync(join(tmpdir(), "crate2-turn-"));
  mkdirSync(join(proj, ".agents", "config"), { recursive: true });
  writeFileSync(join(proj, ".agents", "config", "reviewer.md"), "# binder");
  writeFileSync(join(proj, "AGENTS.md"), "# agents");
  const p = composeTurnPrompt(proj, "reviewer", [
    { at: "2026-07-12T10:00:00Z", from: "orchestrator", body: "review feature/x" } as never,
  ]);
  assert.match(p, /\.agents\/config\/reviewer\.md/); // pointer, not paste
  assert.match(p, /AGENTS\.md/);
  assert.doesNotMatch(p, /# binder/); // never inlined (token discipline)
  assert.match(p, /orchestrator: review feature\/x/);
  assert.match(p, /state\/reviewer\.md/); // the freshness-law reminder rides every turn
});
