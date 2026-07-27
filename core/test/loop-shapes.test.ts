// The state machine's loop shapes, pinned against the REAL shipped
// config/state-machine.yaml (not a hand-simplified fixture — the run-#14
// fixture law). Covers the two shapes added post-Phase-6: research (a spike
// on the books, no merge) and rollback (bad merge before close → full loop).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "crate2-shapes-"));
const rig = join(scratch, "rig");
mkdirSync(join(rig, ".agents", "state"), { recursive: true });
mkdirSync(join(rig, ".agents", "config"), { recursive: true });
writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
copyFileSync(join(ROOT, "config", "state-machine.yaml"), join(rig, ".agents", "config", "state-machine.yaml"));
copyFileSync(join(ROOT, "config", "handoffs.yaml"), join(rig, ".agents", "config", "handoffs.yaml"));
writeFileSync(join(rig, ".agents", "state", "events.log"), "");

function ctl(...args: string[]): { out: string; code: number } {
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
const emit = (name: string) => ctl("emit", name, "--actor", "orchestrator");
const state = () => ctl("state").out.trim();

test("research shape: a spike is on the books (idle → researching → idle) and abandonable", () => {
  assert.equal(emit("boot").code, 0);
  assert.equal(emit("start_research").code, 0);
  assert.equal(state(), "researching");
  assert.equal(emit("research_done").code, 0);
  assert.equal(state(), "idle");
  // and abandon covers a killed spike too
  assert.equal(emit("start_research").code, 0);
  assert.equal(emit("abandon").code, 0);
  assert.equal(state(), "idle");
});

test("research refuses to start mid-build (no state-skipping)", () => {
  assert.equal(emit("start_impl").code, 0); // idle -> implementing
  const r = emit("start_research");
  assert.equal(r.code, 1);
  assert.match(r.out, /REJECTED/);
  assert.equal(state(), "implementing");
});

test("rollback shape: deployed → implementing (and NOT legal from anywhere else)", () => {
  assert.equal(emit("code_ready").code, 0);
  assert.equal(emit("approved").code, 0);
  // T3: the merge is held until the operator's "merge go"
  assert.equal(ctl("emit", "gate_release", "--actor", "operator", "phrase=merge go").code, 0);
  assert.equal(emit("deployed").code, 0);
  assert.equal(emit("rollback").code, 0, "bad merge caught before close must have a legal path");
  assert.equal(state(), "implementing");
  // the revert rides the FULL loop again
  assert.equal(emit("code_ready").code, 0);
  const early = emit("rollback");
  assert.equal(early.code, 1, "rollback is only legal from deployed");
  assert.match(early.out, /REJECTED/);
});

test("rollback handoff signals the coder", () => {
  const raw = execFileSync("cat", [join(rig, ".agents", "config", "handoffs.yaml")], { encoding: "utf8" });
  assert.match(raw, /rollback: rollback \| orchestrator \| coder \| \[ROLLBACK\]/);
});
