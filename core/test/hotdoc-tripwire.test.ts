// The HOT-DOC BUDGET TRIPWIRE (backlog #9), pinned against the REAL shipped
// agentctl: hot records must stay small (every line taxes every future turn),
// so at loop close code MEASURES the hot docs and any doc over budget files
// the distillation chore MECHANICALLY — one dedup'd mail to the orchestrator,
// nagging once per breach (not once per loop), re-arming when the doc drops
// back within budget. The trigger is code; the compaction stays agent judgment.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function mkRig(name: string): string {
  const rig = join(mkdtempSync(join(tmpdir(), "crate2-hotdoc-")), name);
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

/** A doc of exactly <n> newline-terminated lines. */
const docOf = (n: number) => Array.from({ length: n }, (_, i) => `- law ${i + 1}`).join("\n") + "\n";

/** Distillation mails currently queued for the orchestrator (maildir new/). */
function distillationMails(rig: string): string[] {
  const dir = join(rig, ".agents", "state", "inbox", "orchestrator", "new");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".msg"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((body) => body.includes("distillation chore"));
}

test("measurement: at-budget is legal, one line over breaches, absent never breaches", () => {
  const rig = mkRig("measure");
  writeFileSync(join(rig, "AGENTS.md"), docOf(300)); // exactly the 300 default — a ceiling, not a fuse
  writeFileSync(join(rig, "CLAUDE.md"), docOf(151)); // one over the 150 default
  const r = ctl(rig, "hotdoc");
  assert.equal(r.code, 0);
  assert.match(r.out, /AGENTS\.md\s+300\/300\s+ok/);
  assert.match(r.out, /CLAUDE\.md\s+151\/150\s+OVER/);
  assert.match(r.out, /PROGRESS\.md\s+0\/150\s+absent/, "an absent doc cannot breach");
});

test("rig.conf overrides the budget per doc; a garbage override falls back to the default", () => {
  const rig = mkRig("override");
  appendFileSync(join(rig, ".agents", "rig.conf"), 'HOTDOC_BUDGET_AGENTS="10"\nHOTDOC_BUDGET_CLAUDE="banana"\n');
  writeFileSync(join(rig, "AGENTS.md"), docOf(11));
  writeFileSync(join(rig, "CLAUDE.md"), docOf(151));
  const r = ctl(rig, "hotdoc");
  assert.match(r.out, /AGENTS\.md\s+11\/10\s+OVER/, "the override must lower the budget");
  assert.match(r.out, /CLAUDE\.md\s+151\/150\s+OVER/, "a typo'd override must never disarm the tripwire");
});

test("sweep mails the orchestrator ONE mechanical distillation chore per breaching doc", () => {
  const rig = mkRig("mail");
  writeFileSync(join(rig, "AGENTS.md"), docOf(310));
  writeFileSync(join(rig, "ISSUES.md"), docOf(200));
  const r = ctl(rig, "hotdoc", "sweep");
  assert.equal(r.code, 0);
  assert.match(r.out, /HOTDOC: AGENTS\.md over budget \(310\/300 lines\)/);
  const mails = distillationMails(rig);
  assert.equal(mails.length, 2, "one mail per breaching doc — same-millisecond mails must not collide");
  const bodies = mails.join("\n");
  assert.match(bodies, /AGENTS\.md at 310\/300 lines — dispatch a distillation chore: compact accumulated laws, prune stale ones, dedupe/);
  assert.match(bodies, /ISSUES\.md at 200\/150 lines — dispatch a distillation chore/);
  // the nag is on the audit record too (events.log), like every mechanical move
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  assert.match(log, /HOTDOC_NAG doc=AGENTS\.md lines=310 budget=300/);
});

test("dedup: a standing breach nags once per breach, not once per sweep", () => {
  const rig = mkRig("dedup");
  writeFileSync(join(rig, "CLAUDE.md"), docOf(180));
  assert.equal(ctl(rig, "hotdoc", "sweep").code, 0);
  assert.equal(distillationMails(rig).length, 1);
  const again = ctl(rig, "hotdoc", "sweep");
  assert.equal(again.code, 0);
  assert.match(again.out, /already filed \(nags once per breach\)/);
  assert.equal(distillationMails(rig).length, 1, "the standing breach must NOT re-mail");
  // growth during the SAME breach still does not re-mail — one breach, one nag
  writeFileSync(join(rig, "CLAUDE.md"), docOf(190));
  ctl(rig, "hotdoc", "sweep");
  assert.equal(distillationMails(rig).length, 1);
});

test("recovery re-arms: dropping back under budget clears the marker; the NEXT breach nags afresh", () => {
  const rig = mkRig("rearm");
  writeFileSync(join(rig, "CLAUDE.md"), docOf(160));
  ctl(rig, "hotdoc", "sweep");
  assert.equal(distillationMails(rig).length, 1);
  writeFileSync(join(rig, "CLAUDE.md"), docOf(100)); // distilled — breach over
  ctl(rig, "hotdoc", "sweep");
  const marker = join(rig, ".agents", "state", "hotdoc-nags");
  assert.ok(!readFileSync(marker, "utf8").includes("CLAUDE.md"), "recovery must clear the marker");
  writeFileSync(join(rig, "CLAUDE.md"), docOf(170)); // a NEW breach
  ctl(rig, "hotdoc", "sweep");
  assert.equal(distillationMails(rig).length, 2, "a fresh breach after recovery must nag again");
});

test("the close duty runs the sweep: a full loop with a fat hot doc files the chore at close", () => {
  const rig = mkRig("close");
  writeFileSync(join(rig, "AGENTS.md"), docOf(305));
  const emit = (name: string, actor = "orchestrator") => ctl(rig, "emit", name, "--actor", actor);
  for (const ev of ["boot", "start_impl", "code_ready", "approved"]) {
    assert.equal(emit(ev).code, 0);
  }
  assert.equal(ctl(rig, "emit", "gate_release", "--actor", "operator", "phrase=merge go").code, 0);
  assert.equal(emit("deployed").code, 0);
  assert.equal(distillationMails(rig).length, 0, "the tripwire fires at CLOSE, not mid-loop");
  const r = emit("close");
  assert.equal(r.code, 0, "a breach must never wedge the close");
  assert.match(r.out, /HOTDOC: AGENTS\.md over budget \(305\/300 lines\)/);
  const mails = distillationMails(rig);
  assert.equal(mails.length, 1);
  assert.match(mails[0]!, /AGENTS\.md at 305\/300 lines — dispatch a distillation chore/);
});
