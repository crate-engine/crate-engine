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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// ── BADGE ABSENCE ≠ HUMANITY (Pack 2 hardening, 2026-08-12; FLAWS "a blocked
// seat COACHES the operator to strip its identity badge — RECURRED") ──

/** Run agentctl through a WRAPPER shell that carries the seat badge while
 * agentctl's own env has it stripped (`env -u CRATE_SEAT`) — the live-coached
 * forgery shape. The trailing `exit $?` keeps bash resident as the BADGED
 * parent (a lone command would be exec'd, replacing the badged process). */
function ctlStripped(
  rig: string,
  seat: string,
  opts: { extraEnv?: Record<string, string> },
  ...args: string[]
): { ok: boolean; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.extraEnv ?? {}), CRATE_SEAT: seat };
  const quoted = args.map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ");
  try {
    return {
      ok: true,
      out: execFileSync("bash", ["-c", `env -u CRATE_SEAT python3 '${AGENTCTL}' ${quoted}; exit $?`], {
        cwd: rig,
        encoding: "utf8",
        env,
      }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** Register <pid> as the coder's live PANE (what the PTY door writes at
 * spawn) — the walk's cross-platform probe: an ancestor that IS a registered
 * pane process means "inside the seat's session" with no env read needed. */
function registerPane(rig: string, pid: number): string {
  const dir = join(rig, ".agents", "state", "turns", "coder");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "pty.json");
  writeFileSync(f, JSON.stringify({ pid, atMs: Date.now() - Math.round(process.uptime() * 1000), agent: "claude" }));
  return f;
}

test("badge-free but INSIDE a pane session: the pane-pid registry catches it — gate_release refused + logged", () => {
  const rig = makeRig("stripped");
  driveToApproved(rig);
  // This test process plays the pane: agentctl's ancestor walk (python → node)
  // finds a registered live pane pid above it — exactly a badge-stripped shell
  // inside the engine-owned TUI.
  const pane = registerPane(rig, process.pid);
  const r = ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.equal(r.ok, false, "badge absence is not proof of humanity");
  assert.match(r.out, /parent process chain does \(coder\)/, "the refusal names the hidden seat");
  assert.match(r.out, /never coach anyone to/i, "the refusal restates the binder law, never a workaround");
  assert.match(events(rig), /REJECTED event=gate_release actor=operator reason=seat_identity_stripped seat=coder/,
    "the stripped forgery is visible in the audit trail");
  assert.equal(ctl(rig, { seat: null }, "emit", "deployed", "--actor", "orchestrator").ok, false, "the gate stayed shut");
  // the pane exits (registry cleared) → the genuinely badge-free operator releases as ever
  rmSync(pane);
  assert.ok(ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "operator", "phrase=merge go").ok);
  assert.ok(ctl(rig, { seat: null }, "emit", "deployed", "--actor", "orchestrator").ok);
});

test("a DEAD pane's stale pty.json never blocks the operator (alive check self-heals)", () => {
  const rig = makeRig("stale-pane");
  driveToApproved(rig);
  registerPane(rig, 99999999); // no such process — a crash-orphaned registry file
  const rel = ctl(rig, { seat: null }, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.ok(rel.ok, rel.out);
});

test("NMGATE_OVERRIDE from inside a pane session (badge-free) is refused the same way", () => {
  const rig = makeRig("stripped-nmgate", 'PROJECT="rig"\nNMGATE_ENFORCE=1\n');
  ctl(rig, { seat: null }, "emit", "start_impl", "--actor", "coder");
  registerPane(rig, process.pid);
  const forged = ctl(rig, { seat: null, extraEnv: { NMGATE_OVERRIDE: "1" } },
    "emit", "code_ready", "--actor", "coder");
  assert.equal(forged.ok, false, "the human's emergency bypass cannot be claimed by un-badging");
  assert.match(events(rig), /REJECTED event=code_ready actor=coder reason=seat_identity_stripped seat=coder/);
});

test("env -u CRATE_SEAT is caught via ancestor ENV on Linux (/proc); macOS relies on the pane registry",
  { skip: process.platform !== "linux" }, () => {
  const rig = makeRig("stripped-env");
  driveToApproved(rig);
  const r = ctlStripped(rig, "coder", {}, "emit", "gate_release", "--actor", "operator", "phrase=merge go");
  assert.equal(r.ok, false, "the badge survives in the parent's /proc environ");
  assert.match(events(rig), /REJECTED event=gate_release actor=operator reason=seat_identity_stripped seat=coder/);
});
