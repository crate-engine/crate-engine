import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seedDefaultsIfAbsent } from "../src/usertier.js";
import { loadUserDefaults } from "../src/staffing.js";

// T8: the cmux inside-out cold-launch tests (insideCmux / hereRefs /
// armPendingOpen) were removed with cmux. `crate open` now boots headless +
// opens the app window (no ~/.crate/pending-open, no ~/.zprofile pane hook).
// What remains here is the first-start staffing SEED (unrelated to transport).

test("seedDefaultsIfAbsent: a fresh home gets the VERIFIED staffing (run #3: empty seed = all-pi built-in)", () => {
  const home = mkdtempSync(join(tmpdir(), "crate2-seed-"));
  assert.equal(seedDefaultsIfAbsent(home), true);
  const ud = loadUserDefaults(home);
  assert.equal(ud?.seats.coder?.agent, "claude");
  assert.equal(ud?.seats.coder?.model, "opus");
  assert.equal(ud?.seats.orchestrator?.agent, "pi");
  assert.equal(ud?.seats.orchestrator?.model, "openai-codex/gpt-5.5");
  // existing defaults are the user's — never touched
  assert.equal(seedDefaultsIfAbsent(home), false);
});

test("seedDefaultsIfAbsent is detection-aware: pi-only machine seeds the Coder on pi, never a seat that can't boot", () => {
  // a machine with ONLY pi installed + signed in (fake PATH; fake HOME markers)
  const home = mkdtempSync(join(tmpdir(), "crate2-seed-pi-"));
  const bin = join(home, "fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "pi"), 0o755);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "auth.json"), '{"openai-codex":{}}');
  assert.equal(seedDefaultsIfAbsent(home, { path: bin }), true);
  const ud = loadUserDefaults(home);
  assert.equal(ud?.seats.coder?.agent, "pi", "coder falls back to the detected agent");
  assert.equal(ud?.seats.coder?.model, "openai-codex/gpt-5.5");
  assert.equal(ud?.seats.orchestrator?.agent, "pi");
});
