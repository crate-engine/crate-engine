// CE-121 — retry state stops being a hand-edited YAML file.
//
// state/retries.yaml is nested and schema'd, and the ORCHESTRATOR updated it every
// round by editing text. On 2026-07-04 an ad-hoc regex edit corrupted it: the
// predictable end of asking a language model to patch structured YAML in place,
// and the same class of bug that made `sed -i` on rig.conf fail silently on macOS
// (cured then by conf-set owning the write).
//
// So code owns the writes: parse into a model, mutate the model, RE-EMIT the whole
// file atomically. There is no partial write left to get wrong. The tests that
// matter most are the compatibility ones — the emitter must produce, and the reader
// must accept, exactly the schema config/orchestrator.md documents, or a rig's
// existing counters break on first contact.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkRig(name: string, retries?: string): string {
  const rig = join(mkdtempSync(join(tmpdir(), "crate2-retry-")), name);
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
  if (retries !== undefined) writeFileSync(join(rig, ".agents", "state", "retries.yaml"), retries);
  return rig;
}

function ctl(rig: string, ...args: string[]): { out: string; code: number } {
  try {
    return {
      out: execFileSync("python3", [join(ROOT, "bin", "agentctl.py"), ...args], { cwd: rig, encoding: "utf8" }),
      code: 0,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

const file = (rig: string): string => readFileSync(join(rig, ".agents", "state", "retries.yaml"), "utf8");

/** The schema EXACTLY as config/orchestrator.md documents it. */
const DOCTRINE_EXAMPLE = `active_task: phase-5.2-autosave
tasks:
  phase-5.2-autosave:
    defect_signature: "form.watch → scheduleSave trigger never fires"
    attempts: 3
    same_defect_streak: 3
    total_rounds: 3
    escalation_state: surgical_applied
    history:
      - {round: 1, type: symptom_brief, result: changes_needed, sha: abc123}
      - {round: 2, type: symptom_brief, result: changes_needed, sha: def456}
      - {round: 3, type: surgical,      result: approved,        sha: ghi789}
resolved: {}
`;

test("retry: reads the DOCUMENTED schema verbatim, including aligned history rows (CE-121)", () => {
  const rig = mkRig("compat", DOCTRINE_EXAMPLE);
  const r = ctl(rig, "retry", "show");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /active_task: phase-5\.2-autosave/);
  assert.match(r.out, /attempts=3 streak=3 rounds=3 escalation=surgical_applied/);
  assert.match(r.out, /defect: form\.watch → scheduleSave trigger never fires/);
  assert.match(r.out, /round 3: surgical -> approved \(ghi789\)/, "extra alignment spaces are tolerated");
});

test("retry: the empty template is valid input (CE-121)", () => {
  const rig = mkRig("empty", readFileSync(join(ROOT, "templates", "state", "retries.yaml"), "utf8"));
  const r = ctl(rig, "retry", "show");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /active_task: \(none\)/);
});

test("retry round: counters advance and the file round-trips through the reader (CE-121)", () => {
  const rig = mkRig("rounds");
  const d = "form.watch → scheduleSave trigger never fires";
  ctl(rig, "retry", "round", "feat/x", "--type", "symptom_brief", "--result", "changes_needed", "--sha", "abc1234567", "--defect", d);
  const second = ctl(rig, "retry", "round", "feat/x", "--type", "symptom_brief", "--result", "changes_needed", "--defect", d);
  assert.match(second.out, /attempts=2 streak=2/, "a repeated signature CONTINUES the streak");

  const third = ctl(rig, "retry", "round", "feat/x", "--type", "surgical", "--result", "approved", "--defect", d, "--escalation", "surgical_applied");
  assert.match(third.out, /attempts=3 streak=3 escalation=surgical_applied/);
  assert.match(third.out, /LADDER: 3 consecutive rounds on the SAME defect/, "the ladder cue fires in code, not from memory");

  // The emitted file must match the documented shape, key order included.
  const text = file(rig);
  assert.match(text, /^active_task: feat\/x$/m);
  assert.match(text, /^ {2}feat\/x:$/m);
  assert.match(text, /^ {4}defect_signature: "form\.watch → scheduleSave trigger never fires"$/m);
  assert.match(text, /^ {4}attempts: 3$/m);
  assert.match(text, /^ {6}- \{round: 1, type: symptom_brief, result: changes_needed, sha: abc123456\}$/m);
  assert.match(text, /do not hand-edit \(CE-121/, "the file says who owns it");

  // And re-reading our own output must give the same answer (no write/read drift).
  assert.match(ctl(rig, "retry", "show").out, /attempts=3 streak=3 rounds=3 escalation=surgical_applied/);
});

test("retry round: a DIFFERENT defect resets the streak to 1, not 0 (CE-121)", () => {
  const rig = mkRig("newdefect");
  ctl(rig, "retry", "round", "feat/x", "--type", "symptom_brief", "--result", "changes_needed", "--defect", "first defect");
  const r = ctl(rig, "retry", "round", "feat/x", "--type", "symptom_brief", "--result", "changes_needed", "--defect", "a completely different defect");
  assert.match(r.out, /attempts=2 streak=1/, "this round IS the first sighting of the new defect");
});

test("retry: bad enum values are REFUSED, so a typo cannot land in the file (CE-121)", () => {
  const rig = mkRig("enums");
  const bad = ctl(rig, "retry", "round", "feat/x", "--type", "guesswork", "--result", "changes_needed");
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--type must be one of/);
  const bad2 = ctl(rig, "retry", "round", "feat/x", "--type", "surgical", "--result", "probably-fine");
  assert.equal(bad2.code, 1);
  assert.match(bad2.out, /--result must be one of/);
  const bad3 = ctl(rig, "retry", "round", "feat/x", "--type", "surgical", "--result", "approved", "--escalation", "panicking");
  assert.equal(bad3.code, 1);
  assert.match(bad3.out, /--escalation must be one of/);
});

test("retry resolve: counts move to resolved so they cannot bleed into the next task (CE-121)", () => {
  const rig = mkRig("resolve");
  ctl(rig, "retry", "round", "feat/x", "--type", "surgical", "--result", "approved", "--defect", "d");
  const r = ctl(rig, "retry", "resolve", "feat/x");
  assert.match(r.out, /archived to resolved/);
  const text = file(rig);
  assert.match(text, /^resolved:$/m);
  assert.match(text, /^tasks: \{\}$/m, "the live table is empty again");
  assert.match(text, /^active_task: ""$/m, "and nothing is active");
  assert.equal(ctl(rig, "retry", "resolve", "feat/x").code, 1, "resolving twice is an error, not a silent no-op");
});

test("orchestrator doctrine points at the command, not at hand-editing (CE-121)", () => {
  const doc = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(doc, /agentctl\.py retry round/, "the write path is named");
  assert.match(doc, /never hand-edit/i, "and hand-editing is ruled out");
});

// ── CE-118: a cross-repo change is TWO loops (Adam's call, 2026-08-17) ──────
// The gate is repo-local by construction — NMGATE_ENFORCE, the gate_pass record
// and gate_ok_for_head all live in one repo's .agents and compare that repo's
// HEAD. One loop therefore cannot prove both halves gated, so claiming it is
// faking state. Adam chose the doctrine answer over building a companion-repo
// gate; the build stays scoped in BACKLOG #18 if two-loop friction proves real.
test("doctrine: a two-repo change is TWO loops, stated as an unbendable rail (CE-118)", () => {
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  const rails = orch.slice(orch.indexOf("### (c) Invariants that NEVER bend"));
  assert.match(rails, /spanning two repos is TWO LOOPS, never one \(CE-118/, "it is a RAIL, not advice");
  assert.match(rails, /gate is repo-local by construction/, "with the mechanical reason");
  assert.match(rails, /faking state/, "tied to the existing never-fake-state rail");
  assert.match(rails, /not a rail to bend/, "and the escape hatch is filing a flaw, not bending");
});
