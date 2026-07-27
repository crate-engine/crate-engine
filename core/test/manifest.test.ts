import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadLoadout, ManifestError } from "../src/manifest.js";

const FIXTURE_BRAIN = join(import.meta.dirname, "fixtures", "brain");

function tempBrain(): string {
  const dir = mkdtempSync(join(tmpdir(), "crate-test-brain-"));
  cpSync(FIXTURE_BRAIN, dir, { recursive: true });
  return dir;
}

test("valid manifest parses to the typed shape with defaults applied", () => {
  const loadout = loadLoadout(FIXTURE_BRAIN, "reviewer");
  assert.equal(loadout.seat, "reviewer");
  assert.equal(loadout.binder, "config/reviewer.md");
  assert.deepEqual(loadout.skills, ["config/skills/test-skill.md"]);
  assert.deepEqual(loadout.append_system, []); // default
  assert.deepEqual(loadout.extensions, []); // default
  assert.equal(loadout.policy.network, true);
  assert.deepEqual(loadout.policy.sandbox_doors, []); // default
  assert.equal(loadout.cli_deps[0]?.heavy, false); // default
});

test("missing manifest file names the seat and the path it looked for", () => {
  assert.throws(
    () => loadLoadout(FIXTURE_BRAIN, "coder"),
    (e: unknown) =>
      e instanceof ManifestError &&
      e.message.includes('no loadout manifest for seat "coder"') &&
      e.message.includes("coder.yaml"),
  );
});

test("binder pointing at a missing file fails with the resolved path", () => {
  const brain = tempBrain();
  rmSync(join(brain, "config", "reviewer.md"));
  assert.throws(
    () => loadLoadout(brain, "reviewer"),
    (e: unknown) =>
      e instanceof ManifestError &&
      e.message.includes("binder points at a file that doesn't exist") &&
      e.message.includes("config/reviewer.md"),
  );
  rmSync(brain, { recursive: true, force: true });
});

test("unknown key is an error, not silence", () => {
  const brain = tempBrain();
  const file = join(brain, "config", "loadouts", "reviewer.yaml");
  writeFileSync(
    file,
    `seat: reviewer\nbinder: config/reviewer.md\ntypo_key: oops\npolicy:\n  tools: read,bash\n  default_model: ""\n  sandbox: readonly\n`,
  );
  assert.throws(
    () => loadLoadout(brain, "reviewer"),
    (e: unknown) => e instanceof ManifestError && /typo_key|unrecognized/i.test(e.message),
  );
  rmSync(brain, { recursive: true, force: true });
});

test("bad tools string gets the plain-words hint", () => {
  const brain = tempBrain();
  writeFileSync(
    join(brain, "config", "loadouts", "reviewer.yaml"),
    `seat: reviewer\nbinder: config/reviewer.md\npolicy:\n  tools: "read, bash"\n  default_model: ""\n  sandbox: readonly\n`,
  );
  assert.throws(
    () => loadLoadout(brain, "reviewer"),
    (e: unknown) => e instanceof ManifestError && e.message.includes('e.g. "read,bash"'),
  );
  rmSync(brain, { recursive: true, force: true });
});

test("seat/filename mismatch is rejected", () => {
  const brain = tempBrain();
  writeFileSync(
    join(brain, "config", "loadouts", "reviewer.yaml"),
    `seat: coder\nbinder: config/reviewer.md\npolicy:\n  tools: read,bash\n  default_model: ""\n  sandbox: readonly\n`,
  );
  assert.throws(
    () => loadLoadout(brain, "reviewer"),
    (e: unknown) => e instanceof ManifestError && e.message.includes("must match"),
  );
  rmSync(brain, { recursive: true, force: true });
});
