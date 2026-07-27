// PHASE-7 T3 — QA compounds: the axe-check accessibility tool (REAL runs
// against fixture pages via the cached chromium) + the regression-first
// doctrine pins the live loop must fire.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(ROOT, "core");
const scratch = mkdtempSync(join(tmpdir(), "crate2-axe-"));

function runAxe(routes: string, out: string): { out: string; code: number } {
  try {
    return {
      out: execFileSync(
        "node",
        ["--import", "tsx", join(CORE, "src", "tools", "axe-check.ts"), "--base", `file://${scratch}`, "--routes", routes, "--out", out],
        { cwd: CORE, encoding: "utf8", timeout: 90_000 },
      ),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

test("axe-check finds real violations (missing alt) and exits 1", () => {
  writeFileSync(join(scratch, "bad.html"), '<!doctype html><html><head><title>t</title></head><body><img src="x.png"></body></html>');
  const r = runAxe("/bad.html", join(scratch, "out-bad"));
  assert.match(r.out, /image-alt/);
  assert.match(r.out, /\[critical\]/);
  assert.match(r.out, /AXE SUMMARY: 1 route\(s\), [1-9]/);
  assert.equal(r.code, 1, "violations must exit 1");
  const json = JSON.parse(readFileSync(join(scratch, "out-bad", "axe-check.json"), "utf8"));
  assert.ok(json.results[0].violations.some((v: { id: string }) => v.id === "image-alt"));
});

test("axe-check passes a clean page and exits 0", () => {
  writeFileSync(
    join(scratch, "good.html"),
    '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><img src="x.png" alt="an x"></main></body></html>',
  );
  const r = runAxe("/good.html", join(scratch, "out-good"));
  assert.match(r.out, /\/good\.html OK \(0 violations\)/);
  assert.equal(r.code, 0);
});

test("degrade-don't-fail is pinned in the tool (honest AXE NOT VERIFIED, exit 0)", () => {
  const src = readFileSync(join(CORE, "src", "tools", "axe-check.ts"), "utf8");
  const degrades = src.match(/AXE NOT VERIFIED —/g) ?? [];
  assert.ok(degrades.length >= 2, "both heavy pieces (axe-core, browser) must degrade honestly");
  assert.match(src, /do not fail the run/);
});

test("doctrine pins: regression FIRST, report order, axe step, perf conditional, loadout entry", () => {
  const tester = readFileSync(join(ROOT, "config", "tester.md"), "utf8");
  assert.match(tester, /Regression first: drive the `AGENTS\.md` Critical Paths/);
  assert.match(tester, /regression result FIRST/);
  assert.match(tester, /axe-check --base/);
  assert.match(tester, /declares a perf budget.*verify and report|declares a perf budget/s);
  const method = readFileSync(join(ROOT, "config", "skills", "qa-method.md"), "utf8");
  assert.match(method, /## 2\. Regression — the accrued critical paths, BEFORE the new thing/);
  assert.match(method, /## 5\. Accessibility pass on the CHANGED pages/);
  assert.match(method, /REGRESSION LEADS/);
  const loadout = readFileSync(join(ROOT, "config", "loadouts", "tester.yaml"), "utf8");
  assert.match(loadout, /name: axe-check/);
});
