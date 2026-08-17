import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isConsoleNoise, resolveRoutes, routesFromAgentsMd } from "../src/tools/qa-sweep.js";
// T8: parseTreeSurfaces (cmux tree parsing) was removed with cmux.

test("routesFromAgentsMd extracts backticked routes from the Critical paths section only", () => {
  const md = [
    "# AGENTS.md",
    "Use `bash .agents/bin/nm-gate <branch>`.",
    "## Critical paths (QA)",
    "1. `/` — submit the form → result renders.",
    "2. `/` — negative freight → error.",
    "3. `/about.html` — renders, nav works.",
    "## Review standards",
    "Blockers: broken `/api/fake` handling.",
  ].join("\n");
  assert.deepEqual(routesFromAgentsMd(md), ["/", "/about.html"]);
});

test("routesFromAgentsMd returns empty when the section is missing", () => {
  assert.deepEqual(routesFromAgentsMd("# nothing here\n`/route`"), []);
});

// ── CE-112: the heading match must not hinge on a capital letter ────────────
test("routesFromAgentsMd matches the heading case-insensitively (CE-112)", () => {
  const md = ["## Critical Paths", "- `/pricing`", "## Next", "- `/nope`"].join("\n");
  assert.deepEqual(routesFromAgentsMd(md), ["/pricing"]);
});

test("routesFromAgentsMd accepts 'Critical routes' and other heading levels (CE-112)", () => {
  assert.deepEqual(routesFromAgentsMd("### critical routes\n- `/a`"), ["/a"]);
  assert.deepEqual(routesFromAgentsMd("# CRITICAL PATHS\n- `/b`"), ["/b"]);
});

test("routesFromAgentsMd stops at the next heading of ANY level (CE-112)", () => {
  const md = ["## Critical paths", "- `/in`", "### Notes", "- `/out`"].join("\n");
  assert.deepEqual(routesFromAgentsMd(md), ["/in"]);
});

// ── CE-112 second half: a degraded sweep must SAY it is degraded ───────────
function fixture(agentsMd?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ce112-"));
  mkdirSync(join(dir, ".agents"), { recursive: true });
  if (agentsMd !== undefined) writeFileSync(join(dir, "AGENTS.md"), agentsMd);
  return dir;
}

test("resolveRoutes prefers --routes and is not degraded (CE-112)", () => {
  const r = resolveRoutes("/a, /b", fixture());
  assert.deepEqual(r.routes, ["/a", "/b"]);
  assert.equal(r.degraded, false);
  assert.equal(r.origin, "--routes");
});

test("resolveRoutes reads AGENTS.md critical paths and is not degraded (CE-112)", () => {
  const r = resolveRoutes(undefined, fixture("## Critical Paths\n- `/x`\n- `/y`"));
  assert.deepEqual(r.routes, ["/x", "/y"]);
  assert.equal(r.degraded, false);
});

test("resolveRoutes flags DEGRADED when AGENTS.md is absent (CE-112)", () => {
  const r = resolveRoutes(undefined, fixture());
  assert.deepEqual(r.routes, ["/"]);
  assert.equal(r.degraded, true);
  assert.match(r.origin, /DEGRADED: no /);
});

test("resolveRoutes flags DEGRADED when the section is missing (CE-112)", () => {
  const r = resolveRoutes(undefined, fixture("# AGENTS.md\nno sections here"));
  assert.equal(r.degraded, true);
  assert.match(r.origin, /no "Critical paths" section/);
});

test("resolveRoutes distinguishes an EMPTY critical-paths section (CE-112)", () => {
  const r = resolveRoutes(undefined, fixture("## Critical paths\nTODO: fill these in\n"));
  assert.equal(r.degraded, true);
  assert.match(r.origin, /heading but no `\/route` in backticks/);
});

// ── CE-115: browser artifacts are filtered, real errors are not ────────────
test("isConsoleNoise catches the compute-pressure artifact (CE-115)", () => {
  assert.equal(isConsoleNoise("Unrecognized feature: 'compute-pressure'."), true);
  assert.equal(
    isConsoleNoise("Error with Permissions-Policy header: Unrecognized feature: 'foo'."),
    true,
  );
});

test("isConsoleNoise does NOT swallow real app errors (CE-115)", () => {
  assert.equal(isConsoleNoise("Uncaught TypeError: x is not a function"), false);
  assert.equal(isConsoleNoise("Failed to load resource: 500"), false);
  // Near-miss: a real error that merely mentions the word.
  assert.equal(isConsoleNoise("compute-pressure observer threw: TypeError"), false);
});

