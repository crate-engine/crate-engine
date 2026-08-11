// The 2026-08-11 flaw-fix batch (Adam: "all those Flaws — go fix them"):
// DEV_URL healing at attach, crew bundle build/apply.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { healDevUrl } from "../src/attach.js";
import { applyCrewBundle, buildCrewBundle, writeCrewBundle, CREW_FILES } from "../src/crew.js";

function rigWith(devUrl: string): string {
  const p = mkdtempSync(join(tmpdir(), "heal-test-"));
  mkdirSync(join(p, ".agents"), { recursive: true });
  writeFileSync(join(p, ".agents", "rig.conf"), `PROJECT="x"\nDEV_URL="${devUrl}"\nAUTO_REVIVE="0"\n`);
  return p;
}

test("healDevUrl: a non-loopback DEV_URL is rewritten to a free loopback port, out loud", async () => {
  const p = rigWith("http://192.168.100.218:3000");
  try {
    const busy = new Set([3100, 3101]); // scan walks past occupied candidates
    const note = await healDevUrl(p, { probeBusy: async (port) => busy.has(port), scanFrom: 3100 });
    assert.ok(note && note.includes("192.168.100.218") && note.includes("http://127.0.0.1:3102"), note);
    assert.match(readFileSync(join(p, ".agents", "rig.conf"), "utf8"), /^DEV_URL="http:\/\/127\.0\.0\.1:3102"$/m);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("healDevUrl: a loopback port already owned by a foreign server is healed too", async () => {
  const p = rigWith("http://localhost:3000");
  try {
    const note = await healDevUrl(p, { probeBusy: async (port) => port === 3000, scanFrom: 3100 });
    assert.ok(note && note.includes("already owned"), note);
    assert.match(readFileSync(join(p, ".agents", "rig.conf"), "utf8"), /127\.0\.0\.1:3100/);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("healDevUrl: a healthy local DEV_URL is left alone (no note, no rewrite)", async () => {
  const p = rigWith("http://localhost:5173");
  try {
    const note = await healDevUrl(p, { probeBusy: async () => false });
    assert.equal(note, undefined);
    assert.match(readFileSync(join(p, ".agents", "rig.conf"), "utf8"), /localhost:5173/);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
});

test("crew bundle: pi/codex carried, claude NEVER; round-trips onto a fresh home at 0600", () => {
  const src = mkdtempSync(join(tmpdir(), "crew-src-"));
  const dst = mkdtempSync(join(tmpdir(), "crew-dst-"));
  try {
    mkdirSync(join(src, ".pi", "agent"), { recursive: true });
    mkdirSync(join(src, ".codex"), { recursive: true });
    mkdirSync(join(src, ".claude"), { recursive: true });
    writeFileSync(join(src, ".pi", "agent", "auth.json"), '{"openai-codex":{"k":"v"}}');
    writeFileSync(join(src, ".pi", "agent", "models.json"), '{"providers":{}}');
    writeFileSync(join(src, ".codex", "auth.json"), '{"t":"x"}');
    writeFileSync(join(src, ".claude", "credentials.json"), "MUST-NEVER-TRAVEL");
    const { bundle, carried, skipped } = buildCrewBundle(src, () => "2026-08-11T00:00:00Z");
    assert.ok(carried.includes(".pi/agent/auth.json") && carried.includes(".codex/auth.json"));
    assert.ok(skipped.includes(".pi/agent/models-store.json"), "absent files are skipped honestly");
    assert.ok(!JSON.stringify(bundle).includes("MUST-NEVER-TRAVEL"), "claude credentials never bundled");
    const bundleFile = join(src, "crew.json");
    writeCrewBundle(bundleFile, bundle);
    assert.equal(statSync(bundleFile).mode & 0o777, 0o600, "bundle is owner-only");
    const { written } = applyCrewBundle(dst, readFileSync(bundleFile, "utf8"));
    assert.deepEqual(written.sort(), carried.sort());
    assert.equal(readFileSync(join(dst, ".pi", "agent", "auth.json"), "utf8"), '{"openai-codex":{"k":"v"}}');
    assert.equal(statSync(join(dst, ".codex", "auth.json")).mode & 0o777, 0o600, "imported files are owner-only");
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  }
});

test("crew import refuses non-bundles and path escapes", () => {
  const dst = mkdtempSync(join(tmpdir(), "crew-hostile-"));
  try {
    assert.throws(() => applyCrewBundle(dst, "not json"), /unparseable/);
    assert.throws(() => applyCrewBundle(dst, '{"foo":1}'), /missing marker/);
    assert.throws(
      () => applyCrewBundle(dst, JSON.stringify({ crateCrewBundle: 1, exportedAt: "x", files: { "../evil": "aGk=" } })),
      /outside the crew set/,
      "a hostile bundle must not become a write primitive",
    );
    void CREW_FILES;
    void chmodSync;
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
});

// ── flaw 4: the deep claude check, pinned with a stub binary (the live
// false-green case: real-looking ~/.claude.json markers, dead credential) ──
import { agentProblem } from "../src/detect.js";

test("deep check: stale markers + loggedIn:false = honest problem; loggedIn:true = ready", () => {
  const bin = mkdtempSync(join(tmpdir(), "fakebin-"));
  const home = mkdtempSync(join(tmpdir(), "fakehome-"));
  try {
    // the trap: markers that read signed-in (survived an uninstall)
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "old@install.gone" }, hasCompletedOnboarding: true }),
    );
    const fake = join(bin, "claude");
    writeFileSync(fake, `#!/bin/sh\necho '{"loggedIn": false}'\n`);
    chmodSync(fake, 0o755);
    assert.equal(agentProblem("claude", home, [], { path: bin }), undefined, "shallow check is fooled — that IS the flaw");
    const deep = agentProblem("claude", home, [], { path: bin, deep: true });
    assert.ok(deep && /sign-in isn't usable/.test(deep.fix), "deep check catches the dead credential");
    writeFileSync(fake, `#!/bin/sh\necho '{"loggedIn": true}'\n`);
    assert.equal(agentProblem("claude", home, [], { path: bin, deep: true }), undefined, "a real login passes deep");
  } finally {
    rmSync(bin, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
