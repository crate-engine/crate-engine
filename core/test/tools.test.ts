import assert from "node:assert/strict";
import { test } from "node:test";
import { routesFromAgentsMd } from "../src/tools/qa-sweep.js";
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

