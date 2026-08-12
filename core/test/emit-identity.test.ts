// SEAT-IDENTITY (emit-identity fix, 2026-08-11; FLAWS "emit identity is
// self-declared"): `--actor` was pure self-declaration — a live coder
// re-emitted `gate_release --actor operator` and merged its own work. The
// runner now stamps CRATE_SEAT=<seat> into every seat child env (runner.test.ts
// proves the stamp), and agentctl refuses operator-only claims made from
// inside a seat. Drives the REAL bin/agentctl.py with the env a seat would
// carry; the CRATE_SEAT-free paths (operator terminal, GUI server) must keep
// working untouched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-emitid-"));

function makeRig(name: string, conf = 'PROJECT="rig"\n'): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), conf);
  writeFileSync(
    join(rig, ".agents", "config", "state-machine.yaml"),
    [
      "initial: idle",
      "always_legal: checkpoint, gate_pass, gate_release",
      "transitions:",
      "  start_impl: idle -> implementing",
      "  code_ready: implementing -> code_ready",
      "  approved: code_ready -> approved",
      "  deployed: approved -> deployed",
    ].join("\n"),
  );
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  return rig;
}

/** Run agentctl in the rig, optionally inside a seat's env (CRATE_SEAT and/or
 * an override prefix). `seat: null` scrubs any inherited CRATE_SEAT — the
 * operator-terminal shape. */
function ctl(
  rig: string,
  opts: { seat?: string | null; extraEnv?: Record<string, string> },
  ...args: string[]
): { ok: boolean; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.extraEnv ?? {}) };
  delete env.CRATE_SEAT;
  if (opts.seat) env.CRATE_SEAT = opts.seat;
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8", env }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const events = (rig: string): string => readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");

function driveToApproved(rig: string): void {
  ctl(rig, { seat: null }, "emit", "start_impl", "--actor", "coder");
  ctl(rig, { seat: null }, "emit", "code_ready", "--actor", "coder");
  ctl(rig, { seat: null }, "emit", "approved", "--actor", "orchestrator");
}

test("a seat FORGING --actor operator on gate_release is refused, and the attempt is LOGGED", () => {
  const rig = makeRig("forge");
  driveToApproved(rig);
  const r = ctl(rig, { seat: "coder" }, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.equal(r.ok, false, "the forged release must not pass");
  assert.match(r.out, /coder seat/, "the refusal names the seat caught forging");
  assert.match(events(rig), /REJECTED event=gate_release actor=operator reason=seat_identity seat=coder/,
    "the forgery attempt must be visible in the audit trail");
  // and the gate stayed shut: deployed still refuses
  const dep = ctl(rig, { seat: null }, "emit", "deployed", "--actor", "orchestrator");
  assert.equal(dep.ok, false, "no release was recorded — the merge stays held");
});

test("the operator's hand-run release (no CRATE_SEAT) still works — the trusted path is untouched", () => {
  const rig = makeRig("handrun");
  driveToApproved(rig);
  const rel = ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
  assert.ok(ctl(rig, { seat: null }, "emit", "deployed", "--actor", "orchestrator").ok);
});

test("CRATE_SEAT=operator is allowed (identity matches the claim)", () => {
  const rig = makeRig("selfsame");
  driveToApproved(rig);
  const rel = ctl(rig, { seat: "operator" }, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
});

test("the stamp must not OVER-BLOCK: deployed from inside the orchestrator seat still passes after a legit release", () => {
  const rig = makeRig("orchok");
  driveToApproved(rig);
  assert.ok(ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "operator", "phrase=merge go").ok);
  // deployed is NOT operator-only — the orchestrator seat merges it as ever
  const dep = ctl(rig, { seat: "orchestrator" }, "emit", "deployed", "--actor", "orchestrator");
  assert.ok(dep.ok, dep.out);
  assert.match(dep.out, /state=deployed/);
});

test("the wrong-actor refusal now leaves a REJECTED line (it used to die silently)", () => {
  const rig = makeRig("wrongactor");
  driveToApproved(rig);
  const r = ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "orchestrator", "phrase=merge go");
  assert.equal(r.ok, false);
  assert.match(events(rig), /REJECTED event=gate_release actor=orchestrator reason=wrong_actor/);
});

test("NMGATE_OVERRIDE=1 from inside a seat is refused (human-only bypass) — and still works CRATE_SEAT-free", () => {
  // NMGATE_ENFORCE=1 arms the code_ready wall; the seat-identity refusal
  // fires BEFORE the gate lookup, so no git checkout is needed here.
  const rig = makeRig("nmgate", 'PROJECT="rig"\nNMGATE_ENFORCE=1\n');
  ctl(rig, { seat: null }, "emit", "start_impl", "--actor", "coder");
  const forged = ctl(rig, { seat: "coder", extraEnv: { NMGATE_OVERRIDE: "1" } },
    "emit", "code_ready", "--actor", "coder");
  assert.equal(forged.ok, false, "a seat cannot claim the human's emergency bypass");
  assert.match(forged.out, /coder seat/);
  assert.match(events(rig), /REJECTED event=code_ready actor=coder reason=seat_identity override=NMGATE_OVERRIDE seat=coder/);
  // the HUMAN's bypass (no CRATE_SEAT) keeps working — logged, as ever
  const human = ctl(rig, { seat: null, extraEnv: { NMGATE_OVERRIDE: "1" } },
    "emit", "code_ready", "--actor", "coder");
  assert.ok(human.ok, human.out);
});
