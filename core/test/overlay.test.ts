import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  composedBrainRoot,
  composeFile,
  listOverlayEntries,
  overlayMode,
  readBaseHashes,
} from "../src/overlay.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-overlay-"));

// ── the pinned marker law (P4-5 Control Room refinement) ────────────────────

test("marker: md-comment form on line 1 = append", () => {
  assert.equal(overlayMode("<!-- crate-overlay: append -->\nextra\n"), "append");
});

test("marker: hash-comment form on line 1 = append", () => {
  assert.equal(overlayMode("# crate-overlay: append\nextra: true\n"), "append");
});

test("marker: no marker = replace; marker NOT on line 1 = replace", () => {
  assert.equal(overlayMode("whole new file\n"), "replace");
  assert.equal(overlayMode("body first\n<!-- crate-overlay: append -->\n"), "replace");
});

test("compose: append strips the marker line and preserves the base", () => {
  const composed = composeFile("# base binder\n", "<!-- crate-overlay: append -->\nMy rule.\n");
  assert.equal(composed, "# base binder\nMy rule.\n");
  assert.ok(!composed.includes("crate-overlay"));
});

test("compose: append onto a base with no trailing newline still separates lines", () => {
  assert.equal(composeFile("# base", "# crate-overlay: append\nextra\n"), "# base\nextra\n");
});

test("compose: replace ignores the base entirely", () => {
  assert.equal(composeFile("# base\n", "new content\n"), "new content\n");
});

test("compose: append onto a MISSING base yields just the overlay body", () => {
  assert.equal(composeFile(undefined, "# crate-overlay: append\nonly-mine\n"), "only-mine\n");
});

// ── the composed brain view ──────────────────────────────────────────────────

function makeBrain(): string {
  const brain = join(scratch, "brain");
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  mkdirSync(join(brain, "bin"), { recursive: true });
  writeFileSync(join(brain, "config", "reviewer.md"), "# reviewer binder\n");
  writeFileSync(join(brain, "config", "coder.md"), "# coder binder\n");
  writeFileSync(join(brain, "config", "loadouts", "reviewer.yaml"), "seat: reviewer\n");
  writeFileSync(join(brain, "bin", "tool"), "#!/bin/sh\n");
  return brain;
}

test("composed view: no overlay entries → the pristine root itself (fast path)", () => {
  const brain = makeBrain();
  const overlay = join(scratch, "empty-overlay");
  mkdirSync(overlay, { recursive: true });
  const out = join(scratch, "out0");
  mkdirSync(out, { recursive: true });
  assert.equal(composedBrainRoot(brain, overlay, out), brain);
});

test("composed view: overlaid file composed, siblings + other dirs reach brain content, pristine untouched", () => {
  const brain = makeBrain();
  const overlay = join(scratch, "overlay");
  mkdirSync(join(overlay, "config"), { recursive: true });
  writeFileSync(join(overlay, "config", "reviewer.md"), "<!-- crate-overlay: append -->\nHouse rule.\n");
  const out = join(scratch, "out1");
  mkdirSync(out, { recursive: true });

  const composed = composedBrainRoot(brain, overlay, out);
  assert.notEqual(composed, brain);
  // the overlaid file is composed
  assert.equal(readFileSync(join(composed, "config", "reviewer.md"), "utf8"), "# reviewer binder\nHouse rule.\n");
  // its sibling and a nested dir resolve to brain content (via links)
  assert.equal(readFileSync(join(composed, "config", "coder.md"), "utf8"), "# coder binder\n");
  assert.equal(readFileSync(join(composed, "config", "loadouts", "reviewer.yaml"), "utf8"), "seat: reviewer\n");
  assert.equal(
    realpathSync(join(composed, "config", "coder.md")),
    realpathSync(join(brain, "config", "coder.md")),
  );
  // untouched top-level dirs stay one symlink
  assert.equal(realpathSync(join(composed, "bin")), realpathSync(join(brain, "bin")));
  // the pristine brain never changed
  assert.equal(readFileSync(join(brain, "config", "reviewer.md"), "utf8"), "# reviewer binder\n");
  // first-seen base hash recorded for the compat pass
  const hashes = readBaseHashes(overlay);
  assert.ok(typeof hashes[join("config", "reviewer.md")] === "string");
});

test("composed view: an overlay entry with NO brain base lands as a new file", () => {
  const brain = makeBrain();
  const overlay = join(scratch, "overlay-new");
  mkdirSync(join(overlay, "config", "skills"), { recursive: true });
  writeFileSync(join(overlay, "config", "skills", "my-skill.md"), "my own skill\n");
  const out = join(scratch, "out2");
  mkdirSync(out, { recursive: true });
  const composed = composedBrainRoot(brain, overlay, out);
  assert.equal(readFileSync(join(composed, "config", "skills", "my-skill.md"), "utf8"), "my own skill\n");
  assert.ok(!existsSync(join(brain, "config", "skills", "my-skill.md")));
});

test("listOverlayEntries: sorted, machinery excluded", () => {
  const overlay = join(scratch, "overlay-list");
  mkdirSync(join(overlay, "config"), { recursive: true });
  writeFileSync(join(overlay, "config", "z.md"), "z\n");
  writeFileSync(join(overlay, "config", "a.md"), "# crate-overlay: append\na\n");
  writeFileSync(join(overlay, ".base-hashes.yaml"), "{}\n");
  const entries = listOverlayEntries(overlay);
  assert.deepEqual(
    entries.map((e) => [e.relPath, e.mode]),
    [
      [join("config", "a.md"), "append"],
      [join("config", "z.md"), "replace"],
    ],
  );
});
