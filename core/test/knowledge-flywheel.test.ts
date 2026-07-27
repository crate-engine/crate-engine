// The knowledge flywheel (Phase-7 T1), pinned against the REAL shipped files
// (run-#14 fixture law): agentctl's warn-never-block rung on an unfilled
// AGENTS.md, the marker parity between agentctl and the shipped template, and
// the doctrine lines the live loop must fire (bootstrap interview, close
// accrual, the stations' Accrual: report lines).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkRig(name: string): string {
  const rig = join(mkdtempSync(join(tmpdir(), "crate2-flywheel-")), name);
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
  copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
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
const emit = (rig: string, name: string) => ctl(rig, "emit", name, "--actor", "orchestrator");

const WARN = /WARNING: AGENTS\.md is still template placeholders/;

test("warns (never blocks) on start_impl while AGENTS.md is the shipped template", () => {
  const rig = mkRig("placeholder");
  copyFileSync(join(ROOT, "templates", "AGENTS.md"), join(rig, "AGENTS.md"));
  assert.equal(emit(rig, "boot").code, 0);
  const r = emit(rig, "start_impl");
  assert.equal(r.code, 0, "the flywheel rung must WARN, never block");
  assert.match(r.out, WARN);
  assert.match(r.out, /bootstrap interview/);
});

test("warns at close too (nothing was banked), with the accrual pointer", () => {
  const rig = mkRig("close-warn");
  copyFileSync(join(ROOT, "templates", "AGENTS.md"), join(rig, "AGENTS.md"));
  for (const ev of ["boot", "start_impl", "code_ready", "approved"]) {
    assert.equal(emit(rig, ev).code, 0);
  }
  assert.equal(ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go").code, 0);
  assert.equal(emit(rig, "deployed").code, 0);
  const r = emit(rig, "close");
  assert.equal(r.code, 0);
  assert.match(r.out, WARN);
  assert.match(r.out, /Accrual/);
});

test("silent once AGENTS.md holds real content; non-flywheel events never warn", () => {
  const rig = mkRig("filled");
  writeFileSync(join(rig, "AGENTS.md"), "# AGENTS.md — rig\n\n## Conventions & Tech Stack\n- Node 20, TypeScript\n");
  assert.equal(emit(rig, "boot").code, 0);
  const impl = emit(rig, "start_impl");
  assert.equal(impl.code, 0);
  assert.doesNotMatch(impl.out, WARN);
  const ready = emit(rig, "code_ready"); // not a flywheel event
  assert.equal(ready.code, 0);
  assert.doesNotMatch(ready.out, WARN);
});

test("an absent AGENTS.md counts as unfilled", () => {
  const rig = mkRig("absent");
  assert.equal(emit(rig, "boot").code, 0);
  const r = emit(rig, "start_impl");
  assert.equal(r.code, 0);
  assert.match(r.out, WARN);
});

test("marker parity: agentctl's banner marker appears verbatim in the shipped template", () => {
  const ctlSrc = readFileSync(join(ROOT, "bin", "agentctl.py"), "utf8");
  const m = ctlSrc.match(/FLYWHEEL_MARKER = "(.+)"/);
  assert.ok(m, "agentctl must define FLYWHEEL_MARKER");
  const template = readFileSync(join(ROOT, "templates", "AGENTS.md"), "utf8");
  assert.ok(template.includes(m![1]!), "the template banner must carry the marker agentctl keys on");
  assert.match(template, /ORCHESTRATOR owns this file/i);
});

test("doctrine pins: bootstrap interview + close accrual are law; stations carry Accrual: lines", () => {
  const orch = readFileSync(join(ROOT, "config", "orchestrator.md"), "utf8");
  assert.match(orch, /## The knowledge flywheel/);
  assert.match(orch, /Bootstrap interview — on the FIRST work direction/);
  assert.match(orch, /ONE question round, max/);
  assert.match(orch, /Post-merge accrual — at every `close`/);
  assert.match(orch, /Critical Paths/);
  for (const binder of ["reviewer.md", "tester.md", "designer.md"]) {
    const src = readFileSync(join(ROOT, "config", binder), "utf8");
    assert.match(src, /`Accrual:` line/, `${binder} must hand the orchestrator an Accrual: line`);
  }
});
