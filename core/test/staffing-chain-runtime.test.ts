// CE-141 — the RUNTIME must staff what the user configured.
//
// Found by the self-driven QA sweep (2026-08-18): a freshly attached rig on a
// Mac whose ~/.crate/defaults.yaml said claude/fable booted its orchestrator as
// `pi` on a third-party account default, while /api/staffing, `crate print` and
// the Team view all reported claude/fable. The blended-pane path (S4 — the
// DEFAULT for eligible seats since CE-2.2) had re-introduced the hand-rolled
// `rig.conf[key] || "pi"` that resolveRigSeats exists to retire, so the user's
// own model choice lost silently on every rig that doesn't name agents in
// rig.conf — which is every rig attach creates.
//
// These pin the chain at the RUNTIME doors, not just the display ones.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveSeatStaffing } from "../src/launcher.js";
import { readTeamView } from "../src/gui/teamview.js";

/** A rig + a home, staged independently so precedence is observable. */
function stage(opts: { rigConf: string; defaults?: string }): { proj: string; home: string } {
  const proj = mkdtempSync(join(tmpdir(), "ce141-proj-"));
  const home = mkdtempSync(join(tmpdir(), "ce141-home-"));
  mkdirSync(join(proj, ".agents", "state"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), opts.rigConf);
  mkdirSync(join(home, ".crate"), { recursive: true });
  if (opts.defaults !== undefined) writeFileSync(join(home, ".crate", "defaults.yaml"), opts.defaults);
  return { proj, home };
}

const DEFAULTS_CLAUDE = `seats:
  orchestrator: { agent: claude, model: fable }
  coder: { agent: claude, model: fable }
  reviewer: { agent: claude, model: fable }
  designer: { agent: claude, model: fable }
  tester: { agent: claude, model: fable }
`;

test("CE-141: a rig that names no agent takes the USER DEFAULT, not a phantom pi", () => {
  // Exactly what attach writes: staffing lines present but COMMENTED OUT.
  const { proj, home } = stage({
    rigConf: 'PROJECT="qa"\n# ORCH_AGENT="pi"\n# ORCH_MODEL=""\n',
    defaults: DEFAULTS_CLAUDE,
  });
  try {
    const s = resolveSeatStaffing(proj, "orchestrator", home);
    assert.equal(s.agent, "claude", "the user's configured agent wins — this is the whole bug");
    assert.equal(s.model, "fable", "and their model rides with it");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CE-141: rig.conf still OUTRANKS the user default (precedence order intact)", () => {
  const { proj, home } = stage({
    rigConf: 'PROJECT="qa"\nORCH_AGENT="pi"\nORCH_MODEL="openai-codex/gpt-5.5"\n',
    defaults: DEFAULTS_CLAUDE,
  });
  try {
    const s = resolveSeatStaffing(proj, "orchestrator", home);
    assert.equal(s.agent, "pi", "a per-repo override is still the top of the chain");
    assert.equal(s.model, "openai-codex/gpt-5.5");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CE-141: no home named = conf-only, floor stays pi (hermetic callers never read the host's ~/.crate)", () => {
  const { proj, home } = stage({ rigConf: 'PROJECT="qa"\n', defaults: DEFAULTS_CLAUDE });
  try {
    const s = resolveSeatStaffing(proj, "orchestrator", undefined, {});
    assert.equal(s.agent, "pi", "the built-in floor is unchanged when there is no defaults layer to read");
    assert.equal(s.model, undefined);
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CE-141: with nothing configured anywhere the floor is still pi — the fix adds a layer, it does not move the floor", () => {
  const { proj, home } = stage({ rigConf: 'PROJECT="qa"\n' }); // no defaults.yaml at all
  try {
    assert.equal(resolveSeatStaffing(proj, "coder", home).agent, "pi");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CE-141: the Team view CARD names the agent the seat actually runs", () => {
  const { proj, home } = stage({ rigConf: 'PROJECT="tv"\n', defaults: DEFAULTS_CLAUDE });
  try {
    const v = readTeamView(proj, 5, home);
    const orch = v.seats.find((s) => s.seat === "orchestrator")!;
    assert.equal(orch.agent, "claude", "the card showed a phantom pi while the seat ran something else");
    assert.equal(orch.model, "fable");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CE-141: a MALFORMED defaults.yaml never blanks the cockpit — the card degrades to rig.conf", () => {
  // The chain throws on invalid defaults (refusing to staff a guessed roster is
  // correct at boot). The VIEW must still render — a broken settings file that
  // blanks the Team page would be a worse bug than the one being fixed.
  const { proj, home } = stage({
    rigConf: 'PROJECT="tv"\nORCH_AGENT="pi"\n',
    defaults: "seats: [this is not the schema\n",
  });
  try {
    const v = readTeamView(proj, 5, home);
    assert.equal(v.seats.length, 5, "every seat still renders");
    assert.equal(v.seats.find((s) => s.seat === "orchestrator")!.agent, "pi", "falls back to what rig.conf says");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
