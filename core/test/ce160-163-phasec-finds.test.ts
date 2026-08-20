// CE-160…CE-163 — the four findings from the FIRST live five-seat loop
// (Phase C, the stranger's rig, 2026-08-20). Every one was found by the loop
// actually running, not by a suite:
//
//   CE-160  the orchestrator emitted START_DESIGN *as the designer* and it was
//           RECORDED — actor forgery was only refused for operator claims.
//           45s later the orchestrator walked its own fake back with an
//           ABANDON. Conscience is not physics.
//   CE-161  the loop parked at design_locked with chat empty and gates empty —
//           the operator was never ASKED, and experienced a stalled loop as a
//           finished one. The hold is now a CARD the engine raises itself.
//   CE-162  `agentctl preview --help` REGISTERED the flag as a URL — a junk
//           card on the operator's Preview surface, which the studio
//           auto-deploy then keys off.
//   CE-163  the Studio's mobile frame asked for a 375px WINDOW, but auto-deploy
//           fires without user activation and plain Chrome ignores popup size
//           features — the clamp now lives in the CONTENT where it cannot be
//           ignored.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { pendingGates } from "../src/gui/teamctl.js";
import { studioPage } from "../src/gui/studiopage.js";
import { teamPage } from "../src/gui/teampage.js";

const AGENTCTL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "agentctl.py");
const scratch = mkdtempSync(join(tmpdir(), "crate2-ce160s-"));

function makeRig(name: string): string {
  const rig = join(scratch, name);
  mkdirSync(join(rig, ".agents", "config"), { recursive: true });
  mkdirSync(join(rig, ".agents", "state"), { recursive: true });
  writeFileSync(join(rig, ".agents", "rig.conf"), 'PROJECT="rig"\n');
  writeFileSync(
    join(rig, ".agents", "config", "state-machine.yaml"),
    ["initial: idle", "always_legal: checkpoint", "transitions:", "  start_design: idle -> designing", "  design_locked: designing -> design_locked"].join("\n"),
  );
  writeFileSync(join(rig, ".agents", "config", "handoffs.yaml"), "handoffs:\n");
  writeFileSync(join(rig, ".agents", "state", "events.log"), "");
  return rig;
}

function ctl(rig: string, seat: string | null, ...args: string[]): { ok: boolean; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CRATE_SEAT;
  if (seat) env.CRATE_SEAT = seat;
  try {
    return { ok: true, out: execFileSync("python3", [AGENTCTL, ...args], { cwd: rig, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// ── CE-160: a seat emits AS ITSELF ──────────────────────────────────────────

test("CE-160: a seat emitting as ANOTHER seat is refused, in plain words", () => {
  const rig = makeRig("forge");
  const r = ctl(rig, "orchestrator", "emit", "start_design", "--actor", "designer");
  assert.equal(r.ok, false, "the live loop RECORDED this exact forgery");
  assert.match(r.out, /a seat emits AS ITSELF/i);
  assert.match(r.out, /deliver them the brief/i, "the refusal must name the right move, not just say no");
  const log = readFileSync(join(rig, ".agents", "state", "events.log"), "utf8");
  assert.match(log, /REJECTED .*reason=actor_forgery seat=orchestrator/);
  assert.ok(!/START_DESIGN actor=designer state/.test(log), "the forged transition must never advance state");
});

test("CE-160: a seat emitting as itself still works", () => {
  const rig = makeRig("self");
  const r = ctl(rig, "designer", "emit", "start_design", "--actor", "designer");
  assert.equal(r.ok, true, r.out);
});

test("CE-160: the badge default (no --actor) is untouched", () => {
  const rig = makeRig("badge");
  const r = ctl(rig, "designer", "emit", "start_design");
  assert.equal(r.ok, true, r.out);
  assert.match(readFileSync(join(rig, ".agents", "state", "events.log"), "utf8"), /actor=designer/);
});

test("CE-160: the operator's badge-free terminal keeps its latitude", () => {
  // recovery flows are the operator's — a badge-free emit with an explicit
  // actor stays legal exactly as before this fix
  const rig = makeRig("op");
  const r = ctl(rig, null, "emit", "start_design", "--actor", "designer");
  assert.equal(r.ok, true, r.out);
});

// ── CE-162: help is help ────────────────────────────────────────────────────

test("CE-162: preview --help prints usage and registers NOTHING", () => {
  const rig = makeRig("help");
  const r = ctl(rig, "orchestrator", "preview", "--help");
  assert.equal(r.ok, false);
  assert.match(r.out, /usage: preview <url>/);
  assert.ok(!existsSync(join(rig, ".agents", "state", "preview.json")), "the live loop's registry carried a literal --help card");
});

test("CE-162: a non-URL is refused before it becomes a broken card", () => {
  const rig = makeRig("nonurl");
  const r = ctl(rig, "designer", "preview", "index.html");
  assert.equal(r.ok, false);
  assert.match(r.out, /must start with http/);
  const ok = ctl(rig, "designer", "preview", "http://127.0.0.1:8099/index.html", "--route", "/", "--label", "x");
  assert.equal(ok.ok, true, ok.out);
});

// ── CE-161: the hold is a card the ENGINE raises ────────────────────────────

test("CE-161: design_locked raises a design gate card from the record alone", () => {
  const rig = makeRig("hold");
  writeFileSync(
    join(rig, ".agents", "state", "events.log"),
    [
      "[2026-08-20T09:40:45-05:00] START_DESIGN actor=designer state=designing",
      "[2026-08-20T09:40:47-05:00] DESIGN_LOCKED actor=designer branch=feature/crate-and-cup-landing state=design_locked",
      "",
    ].join("\n"),
  );
  const gates = pendingGates(rig);
  assert.equal(gates.length, 1, "the live loop had ZERO cards at this exact state — that emptiness was the bug");
  assert.equal(gates[0]!.kind, "design");
  assert.equal(gates[0]!.branch, "feature/crate-and-cup-landing", "the branch comes from the DESIGN_LOCKED event itself");
});

test("CE-161: the cockpit renders the design hold with Confirm and Reopen", () => {
  const page = teamPage({ project: "x", seats: [] });
  assert.match(page, /design ready —/);
  assert.match(page, /gbconfirm/);
  assert.match(page, /gbreopen/);
  // Confirm speaks through the ONE human door (the orchestrator chat), so the
  // orchestrator's runner wakes exactly as if the operator typed it
  assert.match(page, /Design confirmed — proceed to implementation/);
});

// ── CE-163: the clamp lives in the content ──────────────────────────────────

test("CE-163: the mobile studio page clamps its own render to 375px", () => {
  const mob = studioPage("mobile");
  assert.match(mob, /data-frame="mobile"/);
  assert.match(mob, /width:375px/);
  assert.match(mob, /classList\.toggle\("on"/, "display must flow through the class or the inline style overrides the clamp");
});

test("CE-163: the desktop studio stays fluid", () => {
  const desk = studioPage("desktop");
  assert.match(desk, /data-frame="desktop"/);
  // the clamp rule is scoped to the mobile body attribute, so desktop keeps 100%
  assert.match(desk, /#stage iframe\{width:100%/);
});

test("cleanup", () => {
  rmSync(scratch, { recursive: true, force: true });
});

// ── CE-165: a murdered session must never stamp a clean exit ────────────────
//
// Battle-driver run #1, D2's aimed probe: SIGKILL to the coder pane's own
// recorded pid stamped "blended claude session exited (exit 0)". node-pty
// reports signal deaths as exitCode 0 + signal N and the handler dropped the
// signal — CE-140's lie, alive on the blended path. The stamp IS the crash
// record; it names the signal now. Live-proven: "killed by signal 9".

test("CE-165: the pty exit handler carries the SIGNAL on both stamp paths", () => {
  const src = readFileSync(new URL("../src/ptyseat.ts", import.meta.url), "utf8");
  assert.match(src, /onExit\(\(\{ exitCode, signal \}\)/, "destructuring only exitCode drops the murder weapon");
  assert.match(src, /killed by signal/, "the record must distinguish murder from retirement");
  const stamps = src.match(/\$\{how\}/g) ?? [];
  assert.ok(stamps.length >= 2, "BOTH exits (blended + operator-left) must stamp honestly");
  assert.match(src, /\.\.\.\(signal \? \{ signal \} : \{\}\)/, "tty.exited carries the signal for programmatic readers");
});
