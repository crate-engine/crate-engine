import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// ── The product surface is ONE list (Adam's question, 2026-08-17) ───────────
// "When we merge go, they need to be for the Linux version, Mac version and the
// dist repo" — and they didn't, quite. publish.sh and check-published.sh each
// held their own literal PRODUCT_PATHS under a comment saying "keep in lockstep
// with" the other, and they had already drifted: the publisher shipped
// apps/linux-shell, the CHECKER never watched it. So the guard against "the
// Linux app is missing from the snapshot" was blind to the Linux app — and that
// exact bug had already happened once (a fresh-user QA run found apps/linux-shell
// missing from every snapshot; the fix reached the publisher at 455377b and never
// the checker). A comment is not an invariant; one list is.
test("the product surface is defined ONCE and both dist scripts source it", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dev", "dist-repo");
  const shared = readFileSync(join(dir, "product-paths.sh"), "utf8");
  const publish = readFileSync(join(dir, "publish.sh"), "utf8");
  const check = readFileSync(join(dir, "check-published.sh"), "utf8");

  // BOTH native shells ride the release — a one-platform release is a half one.
  assert.match(shared, /^\s*apps\/mac-shell$/m);
  assert.match(shared, /^\s*apps\/linux-shell$/m);
  assert.match(shared, /^\s*core$/m, "the engine itself");

  for (const [name, src] of [["publish.sh", publish], ["check-published.sh", check]] as const) {
    assert.match(src, /\. "\$\(cd "\$\(dirname "\$0"\)" && pwd\)\/product-paths\.sh"/, `${name} sources the shared list`);
    assert.doesNotMatch(src, /^PRODUCT_PATHS=\(/m, `${name} must NOT keep its own copy — that is the drift that happened`);
  }
});
