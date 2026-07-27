// Pi model discovery (PDR dev/pdr/pi-model-discovery.md, grilled 2026-07-26):
// the staffing page sees what Pi sees — credentialed providers only, blocked
// providers shown with the fix (never hidden), never battle-tested, metered-
// honest, curated wins collisions. Fixtures are the REAL file shapes from
// ~/.pi/agent on Adam's Mac (auth.json / models.json / models-store.json).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverPiModels } from "../src/pidiscovery.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-pidisc-"));
let n = 0;

function home(files: Record<string, unknown>): string {
  const h = join(scratch, `home-${n++}`);
  mkdirSync(join(h, ".pi", "agent"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(h, ".pi", "agent", name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return h;
}

const KIMI = {
  providers: {
    moonshot: {
      baseUrl: "https://api.moonshot.ai",
      api: "openai-completions",
      apiKey: "sk-live-kimi-key",
      models: [{ id: "kimi-k3", name: "Kimi K3", contextWindow: 512000 }],
    },
  },
};

test("the Kimi case: a custom provider with a literal key is discovered ready, metered-honest, untested", () => {
  const h = home({ "models.json": KIMI });
  const got = discoverPiModels(h, { piInstalled: true });
  assert.equal(got.length, 1);
  const k = got[0]!;
  assert.equal(k.model, "moonshot/kimi-k3");
  assert.equal(k.display, "Kimi K3 (Pi · detected)");
  assert.equal(k.ready, true);
  assert.equal(k.discovered, true);
  assert.deepEqual(k.verifiedFor, [], "discovery can never mint a battle-test label");
  assert.match(k.billing, /METERED/i);
});

test("Q3: an unresolvable $ENV_VAR key is SHOWN blocked with the fix — never hidden; setting the var flips it ready", () => {
  const cfg = { providers: { moonshot: { apiKey: "$KIMI_TEST_KEY_UNSET", models: [{ id: "kimi-k3", name: "Kimi K3" }] } } };
  const h = home({ "models.json": cfg });
  const blocked = discoverPiModels(h, { piInstalled: true, env: {} });
  assert.equal(blocked.length, 1, "blocked entries still appear");
  assert.equal(blocked[0]!.ready, false);
  assert.match(blocked[0]!.fix ?? "", /\$KIMI_TEST_KEY_UNSET/, "the fix names the missing variable");
  const ready = discoverPiModels(h, { piInstalled: true, env: { KIMI_TEST_KEY_UNSET: "sk-now-set" } });
  assert.equal(ready[0]!.ready, true);
  assert.equal(ready[0]!.fix, undefined);
});

test("signed-in providers (auth.json) get their models from Pi's store", () => {
  const h = home({
    "auth.json": { "openai-codex": { type: "oauth" } },
    "models-store.json": {
      "openai-codex": { models: [{ id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" }] },
      deepseek: { models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] },
    },
  });
  const got = discoverPiModels(h, { piInstalled: true });
  assert.deepEqual(got.map((m) => m.model), ["openai-codex/gpt-5.3-codex-spark"], "no key = no listing (deepseek stays out)");
});

test("the P0-5 scar stays loud: anthropic-via-Pi carries the flat-rate trap warning, not the generic label", () => {
  const h = home({
    "auth.json": { anthropic: { type: "api-key" } },
    "models-store.json": { anthropic: { models: [{ id: "claude-fable-5", name: "Claude Fable 5" }] } },
  });
  const got = discoverPiModels(h, { piInstalled: true });
  assert.match(got[0]!.billing, /does NOT run flat through Pi/);
});

test("curated wins collisions; custom models.json wins over the store for the same provider/id", () => {
  const h = home({
    "auth.json": { "openai-codex": {}, deepseek: {} },
    "models-store.json": {
      "openai-codex": { models: [{ id: "gpt-5.5", name: "GPT-5.5" }, { id: "gpt-5.3-codex-spark", name: "Spark" }] },
      deepseek: { models: [{ id: "deepseek-v4-pro", name: "Store Name" }] },
    },
    "models.json": { providers: { deepseek: { apiKey: "sk-x", models: [{ id: "deepseek-v4-pro", name: "Custom Name" }] } } },
  });
  const curated = [{ agent: "pi", model: "openai-codex/gpt-5.5" }];
  const got = discoverPiModels(h, { piInstalled: true, curated });
  assert.ok(!got.some((m) => m.model === "openai-codex/gpt-5.5"), "curated entry wins — discovered copy dropped");
  const ds = got.filter((m) => m.model === "deepseek/deepseek-v4-pro");
  assert.equal(ds.length, 1, "one entry per provider/id");
  assert.equal(ds[0]!.display, "Custom Name (Pi · detected)", "models.json definition wins over the store cache");
  assert.ok(got.some((m) => m.model === "openai-codex/gpt-5.3-codex-spark"));
});

test("pi not installed blankets everything with the install fix", () => {
  const h = home({ "models.json": KIMI });
  const got = discoverPiModels(h, { piInstalled: false });
  assert.equal(got[0]!.ready, false);
  assert.match(got[0]!.fix ?? "", /not installed/);
});

test("defensive floor: missing dir, malformed JSON, and keyless providers never throw", () => {
  assert.deepEqual(discoverPiModels(join(scratch, "no-such-home")), []);
  const h = home({ "models.json": "{not json", "auth.json": "[]", "models-store.json": "null" });
  assert.deepEqual(discoverPiModels(h, { piInstalled: true }), []);
  const h2 = home({ "models.json": { providers: { moonshot: { models: [{ id: "kimi-k3", name: "Kimi K3" }] } } } });
  const got = discoverPiModels(h2, { piInstalled: true, env: {} });
  assert.equal(got[0]!.ready, false, "no apiKey field = not credentialed");
  assert.match(got[0]!.fix ?? "", /without an API key/);
});
