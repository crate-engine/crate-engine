import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Mac recent-project history persists five identities and reconstructs fresh connection URLs", { skip: process.platform !== "darwin" }, () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), "recent-swift-"));
  try {
    const exe = join(scratch, "test");
    execFileSync("swiftc", [join(root, "apps/mac-shell/RecentProjects.swift"), join(root, "core/test/fixtures/recent-projects/main.swift"), "-o", exe]);
    assert.match(execFileSync(exe, { encoding: "utf8" }), /tests PASS/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
