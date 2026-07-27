// The T1-live-loop find (p7-scratch-t1): a FALLBACK-branch seat — any staffing
// that is neither a matching manifest (pi-on-pi-loadout) nor adapter-claude,
// e.g. pi cross-staffed on a claude-code-loadout seat — launched as a RAW
// adapter command with no `cd`, so the agent inherited the pane's cwd and
// aimed its file tools at the wrong repo. Every seat must launch from the
// PROJECT ROOT, agent-agnostically. Drives the REAL planSeats.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planSeats } from "../src/launcher.js";

const scratch = mkdtempSync(join(tmpdir(), "crate2-cwd-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

function makeBrain(): string {
  const brain = join(scratch, "brain");
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  mkdirSync(join(brain, "config", "sandbox"), { recursive: true });
  writeFileSync(join(brain, "config", "reviewer.md"), "# reviewer binder\n");
  // The real-world shape of the bug: the seat's loadout declares claude-code,
  // but the STAFFING puts pi there (the p7 rig's coder) → fallback branch.
  writeFileSync(
    join(brain, "config", "loadouts", "reviewer.yaml"),
    [
      "seat: reviewer",
      "agent: claude-code",
      "binder: config/reviewer.md",
      "policy:",
      "  tools: read,bash",
      "  default_model: opus",
      "  sandbox: readonly",
    ].join("\n"),
  );
  for (const tpl of ["readonly", "standard"]) {
    writeFileSync(join(brain, "config", "sandbox", `${tpl}.sb.tpl`), `(version 1)\n; ${tpl} {{PROJECT}} {{HOME}}\n; {{DOORS}}\n`);
  }
  return brain;
}

function makeProject(brain: string, rigConf: string): string {
  const proj = join(scratch, `proj-${Math.abs(rigConf.length * 7919) % 100000}`);
  mkdirSync(join(proj, ".agents", "adapters", "pi"), { recursive: true });
  mkdirSync(join(proj, ".agents", "adapters", "hermes"), { recursive: true });
  symlinkSync(join(brain, "config"), join(proj, ".agents", "config"));
  writeFileSync(join(proj, ".agents", "rig.conf"), rigConf);
  for (const [agent, line] of [["pi", "pi --model ${1:-default}"], ["hermes", "hermes-tui"]] as const) {
    const launch = join(proj, ".agents", "adapters", agent, "launch.sh");
    writeFileSync(launch, `#!/usr/bin/env bash\necho "${line}"\n`);
    chmodSync(launch, 0o755);
  }
  return proj;
}

const brain = makeBrain();

test("cross-staffed fallback seat (pi on a claude-code loadout) launches via a script that cds to the project root", async () => {
  const proj = makeProject(brain, 'REVIEWER_AGENT="pi"; REVIEWER_MODEL="openai-codex/gpt-5.5"\n');
  const { seats } = await planSeats(proj, { brainRoot: brain, home: HOME, preflight: false });
  const rev = seats.find((s) => s.seat === "reviewer")!;
  assert.equal(rev.staffed.agent, "pi");
  assert.equal(rev.manifestDriven, false);
  assert.match(rev.launchCommand, /^bash /, "fallback seats must launch via a script, not a raw command");
  const script = readFileSync(rev.launchCommand.replace(/^bash /, ""), "utf8");
  assert.ok(script.includes(`cd '${proj}'`), "the launch script must cd to the project root");
  assert.match(script, /exec pi --model/);
  // the fallback stays UNWALLED (pi/hermes run their own approvals; the
  // walled set is claude+codex, which never reach this branch)
  assert.equal(rev.profilePath, undefined);
  assert.doesNotMatch(script, /sandbox-exec/);
});

test("no-loadout fallback seats (v1 adapter) get the cwd pin too", async () => {
  const proj = makeProject(brain, 'CODER_AGENT="hermes"; CODER_MODEL=""\n');
  const { seats } = await planSeats(proj, { brainRoot: brain, home: HOME, preflight: false });
  const coder = seats.find((s) => s.seat === "coder")!;
  assert.match(coder.launchCommand, /^bash /);
  const script = readFileSync(coder.launchCommand.replace(/^bash /, ""), "utf8");
  assert.ok(script.includes(`cd '${proj}'`));
  assert.match(script, /exec hermes-tui/);
  assert.equal(coder.profilePath, undefined);
});
