import assert from "node:assert/strict";
import { test } from "node:test";
import { ADVISORY, CEILING, contextWindowFor, gaugeFrom } from "../src/gui/context.js";

// PHASE-8 T4 (D12): context fullness gauge from session input tokens.

test("contextWindowFor maps models to windows, defaults safely", () => {
  assert.equal(contextWindowFor("openai-codex/gpt-5.5"), 272_000);
  assert.equal(contextWindowFor("deepseek/deepseek-v4-pro"), 128_000);
  assert.equal(contextWindowFor("gemini/pro"), 1_000_000);
  assert.equal(contextWindowFor("some-unknown-model"), 128_000);
  assert.equal(contextWindowFor(undefined), 128_000);
});

// Adam's gauge catch (2026-08-12): the orchestrator pane read 91% while the
// session's real /context said ~10% — "fable" matched NO row and fell to the
// 128k default (116k/128k = 91%; truth was 116k/1M = 11.6%). The whole current
// Claude line is a 1M window; only haiku is 200k. Verified against the model
// catalog — the gauge must never overstate by falling to a stale default.
test("claude-family windows are 1M — the 91%-vs-10% inversion never returns", () => {
  assert.equal(contextWindowFor("fable"), 1_000_000);
  assert.equal(contextWindowFor("mythos"), 1_000_000);
  assert.equal(contextWindowFor("opus"), 1_000_000);
  assert.equal(contextWindowFor("sonnet"), 1_000_000);
  assert.equal(contextWindowFor("claude-opus-5"), 1_000_000);
  assert.equal(contextWindowFor("haiku"), 200_000, "haiku is the 200k exception and must match before the family catch-all");
  // The exact live repro: ~116k tokens on fable reads ~12%, never 91%.
  const g = gaugeFrom(116_000, "fable")!;
  assert.ok(g.pct < 0.15, `fable at 116k tokens must read ~12%, got ${Math.round(g.pct * 100)}%`);
  assert.equal(g.band, "ok");
});

test("gaugeFrom: bands at Adam's 40% advisory and the hard ceiling", () => {
  const w = contextWindowFor("openai-codex/gpt-5.5"); // 272k
  assert.equal(gaugeFrom(Math.round(w * 0.1), "openai-codex/gpt-5.5")!.band, "ok");
  assert.equal(gaugeFrom(Math.round(w * (ADVISORY + 0.01)), "openai-codex/gpt-5.5")!.band, "advisory");
  assert.equal(gaugeFrom(Math.round(w * (CEILING + 0.01)), "openai-codex/gpt-5.5")!.band, "high");
});

test("gaugeFrom: pct is fraction of window, capped at 1; no tokens → undefined", () => {
  const g = gaugeFrom(27_200, "openai-codex/gpt-5.5")!; // 10% of 272k
  assert.ok(Math.abs(g.pct - 0.1) < 0.001);
  assert.equal(g.window, 272_000);
  assert.equal(gaugeFrom(999_999_999, "openai-codex/gpt-5.5")!.pct, 1);
  assert.equal(gaugeFrom(undefined, "opus"), undefined);
  assert.equal(gaugeFrom(0, "opus"), undefined);
});
