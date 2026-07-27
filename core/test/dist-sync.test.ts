import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

// The Control Room's P6 refinement (same drift family as the P5 stranded fix):
// the product runs DIST-ONLY from the committed clone, so committed core/dist
// must equal a fresh build of core/src — else a source edit ships a silently
// stale CLI. `npm run dist-check` builds to .dist-check/ (same depth as dist/,
// so sourcemap relative paths match) and diffs recursively.

test("dist-sync guard: committed dist == fresh build of src", () => {
  const core = join(import.meta.dirname, "..");
  const out = execFileSync("npm", ["run", "dist-check"], { cwd: core, encoding: "utf8" });
  assert.match(out, /dist-sync OK/);
});
