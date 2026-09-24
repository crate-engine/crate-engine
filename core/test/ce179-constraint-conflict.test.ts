// CE-179 (docket loop 2026-09-13): the brief said "no production access", the
// repo's only database is production — the coder reported a BLOCKER, then kept
// engineering around it (namespace experiments, dotenv dummies, a wrapper
// design) and the orchestrator re-issued SCOPE_OK without resolving it. The
// walls rule allowed any REVERSIBLE workaround, which licensed working around
// the operator's own instruction. The law now splits the two cases in every
// binder; this pins it so an edit cannot quietly drop it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const binder = (role: string): string =>
  readFileSync(new URL(`../../config/${role}.md`, import.meta.url), "utf8");

/** The Hard Constraints section only — the law must sit where seats read rules. */
const hardConstraints = (role: string): string => {
  const s = binder(role);
  const start = s.indexOf("## Hard Constraints");
  assert.ok(start >= 0, `${role}.md has a Hard Constraints section`);
  const end = s.indexOf("\n## ", start + 1);
  return s.slice(start, end < 0 ? undefined : end);
};

for (const role of ["coder", "tester", "reviewer", "designer"]) {
  test(`${role}: a brief the repo cannot honor = ONE blocker, then HOLD — never engineered around`, () => {
    const hc = hardConstraints(role);
    assert.match(hc, /ONE blocker, then HOLD/);
    assert.match(hc, /Never engineer\s+around an operator instruction/);
    assert.match(hc, /technical\s+obstacle[\s\S]*reversible\s+workaround is still fine/, "technical walls keep their latitude");
  });
}

test("orchestrator: relays the conflict ONCE and never re-issues SCOPE_OK while it is open", () => {
  const hc = hardConstraints("orchestrator");
  assert.match(hc, /constraint conflict goes to the human, ONCE — then HOLD/);
  assert.match(hc, /never re-issue `SCOPE_OK`/);
  assert.match(hc, /only the operator's ruling resolves it/);
});

test("orchestrator: the walls-mid-task workaround latitude is scoped to TECHNICAL walls", () => {
  assert.match(binder("orchestrator"), /Walls mid-task[\s\S]{0,700}TECHNICAL walls only/);
});
