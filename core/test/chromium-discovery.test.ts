import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromiumFromCache, defaultCacheRoots } from "../src/tools/qa-sweep.js";

// FLAWS "qa-sweep's chromium-cache discovery is macOS-only": the cache scan
// now checks BOTH platform roots and the Linux executable layouts (verbatim
// from Superman's real ~/.cache/ms-playwright, 2026-07-12:
// chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell
// and chromium-1223/chrome-linux64/chrome). The candidate list is the ONE
// canonical list — bin/mobile-check.js and core/tools/qa-chrome mirror it.

const scratch = mkdtempSync(join(tmpdir(), "crate2-chromium-disc-"));

function plant(root: string, ...rel: string[]): string {
  const p = join(root, ...rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "#!/bin/sh\n", { mode: 0o755 });
  return p;
}

test("defaultCacheRoots lists the macOS AND Linux playwright roots for a home", () => {
  const roots = defaultCacheRoots("/home/u");
  assert.deepEqual(roots, [
    join("/home/u", "Library", "Caches", "ms-playwright"),
    join("/home/u", ".cache", "ms-playwright"),
  ]);
});

test("Linux layout: headless shell found under ~/.cache (the Superman shape)", () => {
  const root = join(scratch, "linux", ".cache", "ms-playwright");
  const exe = plant(root, "chromium_headless_shell-1223", "chrome-headless-shell-linux64", "chrome-headless-shell");
  assert.equal(chromiumFromCache([root]), exe);
});

test("Linux layout: full chrome (chrome-linux64) found when no headless shell", () => {
  const root = join(scratch, "linux2", ".cache", "ms-playwright");
  const exe = plant(root, "chromium-1223", "chrome-linux64", "chrome");
  assert.equal(chromiumFromCache([root]), exe);
});

test("older Linux layout (chrome-linux/chrome) still found", () => {
  const root = join(scratch, "linux3", ".cache", "ms-playwright");
  const exe = plant(root, "chromium-1100", "chrome-linux", "chrome");
  assert.equal(chromiumFromCache([root]), exe);
});

test("macOS arm64 headless shell still found (no regression)", () => {
  const root = join(scratch, "mac", "Library", "Caches", "ms-playwright");
  const exe = plant(root, "chromium_headless_shell-1228", "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  assert.equal(chromiumFromCache([root]), exe);
});

test("newest version dir wins; a missing first root falls through to the second", () => {
  const macRoot = join(scratch, "multi", "Library", "Caches", "ms-playwright"); // never created
  const linuxRoot = join(scratch, "multi", ".cache", "ms-playwright");
  plant(linuxRoot, "chromium_headless_shell-1217", "chrome-headless-shell-linux64", "chrome-headless-shell");
  const newest = plant(linuxRoot, "chromium_headless_shell-1223", "chrome-headless-shell-linux64", "chrome-headless-shell");
  assert.equal(chromiumFromCache([macRoot, linuxRoot]), newest);
});

test("empty cache → undefined (findChromium's loud error is built on this)", () => {
  assert.equal(chromiumFromCache([join(scratch, "nowhere")]), undefined);
});
