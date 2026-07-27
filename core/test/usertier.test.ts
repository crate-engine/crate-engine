import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setupTier, tierPaths, updateEngine, UserTierError } from "../src/usertier.js";

// Hermetic law (Phase 4): every test runs on a fake HOME under mktemp; the
// real account is never touched.
const scratch = mkdtempSync(join(tmpdir(), "crate2-usertier-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A tiny throwaway "brain" repo to clone as the engine source. */
function makeBrainSource(): string {
  const src = join(scratch, "brain-src");
  mkdirSync(join(src, "config"), { recursive: true });
  writeFileSync(join(src, "config", "reviewer.md"), "# reviewer binder v1\n");
  git(["init", "--quiet"], src);
  git(["add", "-A"], src);
  git(["commit", "--quiet", "-m", "brain v1"], src);
  return src;
}
const brainSrc = makeBrainSource();

test("setup: fresh tier — clone + seed + overlay dir", () => {
  const r = setupTier(HOME, { engineSource: brainSrc });
  const t = tierPaths(HOME);
  assert.ok(existsSync(t.defaultsFile));
  assert.ok(existsSync(t.overlayDir));
  assert.ok(existsSync(join(t.engineDir, ".git")));
  // run #3: the seed now carries the VERIFIED staffing (an empty seed left
  // every seat on the built-in pi fallback and broke the fresh-account boot)
  const seeded = readFileSync(t.defaultsFile, "utf8");
  assert.match(seeded, /coder: \{ agent: claude, model: opus \}/);
  assert.match(seeded, /orchestrator: \{ agent: pi, model: openai-codex\/gpt-5\.5 \}/);
  assert.equal(r.actions.filter((a) => a.startsWith("cloned")).length, 1);
  // pristine by construction
  assert.equal(git(["status", "--porcelain"], t.engineDir).trim(), "");
});

test("setup: re-run is a no-op that keeps user content", () => {
  const t = tierPaths(HOME);
  writeFileSync(t.defaultsFile, "seats:\n  reviewer: { agent: pi }\n");
  const r = setupTier(HOME, { engineSource: brainSrc });
  assert.ok(r.actions.every((a) => a.startsWith("kept")));
  assert.match(readFileSync(t.defaultsFile, "utf8"), /reviewer/);
});

test("setup: heals a partially-missing tier", () => {
  const t = tierPaths(HOME);
  rmSync(t.overlayDir, { recursive: true });
  const r = setupTier(HOME, { engineSource: brainSrc });
  assert.ok(existsSync(t.overlayDir));
  assert.ok(r.actions.some((a) => a.startsWith("created overlay")));
});

test("setup: refuses a non-git engine dir (actionable)", () => {
  const home2 = join(scratch, "home2");
  const t2 = tierPaths(home2);
  mkdirSync(t2.engineDir, { recursive: true });
  writeFileSync(join(t2.engineDir, "junk.txt"), "not a clone");
  assert.throws(() => setupTier(home2, { engineSource: brainSrc }), UserTierError);
});

test("update: fast-forwards the pristine clone; untouched overlay stays silent", () => {
  writeFileSync(join(brainSrc, "config", "reviewer.md"), "# reviewer binder v2\n");
  git(["commit", "--quiet", "-am", "brain v2"], brainSrc);
  const r = updateEngine(HOME);
  assert.notEqual(r.before, r.after);
  assert.ok(r.fastForwarded);
  assert.equal(r.flagged.length, 0);
  const t = tierPaths(HOME);
  assert.match(readFileSync(join(t.engineDir, "config", "reviewer.md"), "utf8"), /v2/);
});

test("update: flags an overlay entry whose base changed — exactly once", () => {
  const t = tierPaths(HOME);
  // overlay the reviewer binder (recorded against v2 by the pre-pull snapshot)
  mkdirSync(join(t.overlayDir, "config"), { recursive: true });
  writeFileSync(
    join(t.overlayDir, "config", "reviewer.md"),
    "<!-- crate-overlay: append -->\nMy custom review rule.\n",
  );
  // upstream changes the base
  writeFileSync(join(brainSrc, "config", "reviewer.md"), "# reviewer binder v3\n");
  git(["commit", "--quiet", "-am", "brain v3"], brainSrc);
  const r1 = updateEngine(HOME);
  assert.equal(r1.flagged.length, 1);
  assert.match(r1.flagged[0]!.note, /changed in this update/);
  // same state again: no NEW base change → no flag
  const r2 = updateEngine(HOME);
  assert.equal(r2.flagged.length, 0);
});

test("update: refuses (plainly) when the clone is not pristine", () => {
  const t = tierPaths(HOME);
  writeFileSync(join(t.engineDir, "config", "reviewer.md"), "# hand-edited — breaking the law\n");
  git(["commit", "--quiet", "-am", "local edit"], t.engineDir);
  writeFileSync(join(brainSrc, "config", "reviewer.md"), "# reviewer binder v4\n");
  git(["commit", "--quiet", "-am", "brain v4"], brainSrc);
  assert.throws(() => updateEngine(HOME), /did not fast-forward|overlay/);
});
