import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planSeats } from "../src/launcher.js";

// P5-0a (TASK-0): an adapter-launched claude seat gets the seat's OWN loadout
// wall + the claude state doors; unwallable claude staffings REFUSE; non-claude
// adapter seats are untouched. These tests drive the REAL planSeats.

const scratch = mkdtempSync(join(tmpdir(), "crate2-walled-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

/** A minimal brain: reviewer loadout (readonly wall) + sandbox templates. */
function makeBrain(): string {
  const brain = join(scratch, "brain");
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  mkdirSync(join(brain, "config", "sandbox"), { recursive: true });
  writeFileSync(join(brain, "config", "reviewer.md"), "# reviewer binder\n");
  writeFileSync(
    join(brain, "config", "loadouts", "reviewer.yaml"),
    [
      "seat: reviewer",
      "binder: config/reviewer.md",
      "policy:",
      "  tools: read,bash",
      "  default_model: openai-codex/gpt-5.5",
      "  sandbox: readonly",
    ].join("\n"),
  );
  for (const tpl of ["readonly", "standard"]) {
    writeFileSync(
      join(brain, "config", "sandbox", `${tpl}.sb.tpl`),
      `(version 1)\n; ${tpl} wall for {{PROJECT}} ({{HOME}})\n; {{DOORS}}\n`,
    );
  }
  return brain;
}

/** A minimal attached project with a claude adapter and a staffing conf. */
function makeProject(brain: string, rigConf: string): string {
  const proj = join(scratch, `proj-${Math.abs(rigConf.length * 7919) % 100000}`);
  mkdirSync(join(proj, ".agents", "adapters", "claude"), { recursive: true });
  mkdirSync(join(proj, ".agents", "adapters", "hermes"), { recursive: true });
  symlinkSync(join(brain, "config"), join(proj, ".agents", "config"));
  writeFileSync(join(proj, ".agents", "rig.conf"), rigConf);
  const launch = join(proj, ".agents", "adapters", "claude", "launch.sh");
  writeFileSync(launch, `#!/usr/bin/env bash\necho "claude --model \${1:-opus}"\n`);
  chmodSync(launch, 0o755);
  const hermes = join(proj, ".agents", "adapters", "hermes", "launch.sh");
  writeFileSync(hermes, `#!/usr/bin/env bash\necho "hermes-tui"\n`);
  chmodSync(hermes, 0o755);
  // seats without a loadout default to pi → they take the v1-adapter path
  mkdirSync(join(proj, ".agents", "adapters", "pi"), { recursive: true });
  const pi = join(proj, ".agents", "adapters", "pi", "launch.sh");
  writeFileSync(pi, `#!/usr/bin/env bash\necho "pi --model \${1:-default}"\n`);
  chmodSync(pi, 0o755);
  return proj;
}

const brain = makeBrain();

test("adapter-claude on a walled loadout: profile rendered + sandbox-exec wrap + claude doors", async () => {
  const proj = makeProject(brain, 'REVIEWER_AGENT="claude"; REVIEWER_MODEL="opus"\n');
  const { seats } = await planSeats(proj, { brainRoot: brain, home: HOME, preflight: false });
  const rev = seats.find((s) => s.seat === "reviewer")!;
  assert.equal(rev.staffed.agent, "claude");
  assert.equal(rev.manifestDriven, false); // still the v1-adapter launch line…
  assert.equal(rev.sandbox, "readonly"); // …but the seat's OWN wall applies
  assert.ok(rev.profilePath && existsSync(rev.profilePath));
  const profile = readFileSync(rev.profilePath!, "utf8");
  assert.match(profile, /readonly wall/);
  assert.match(profile, /\.claude/); // the claude state doors merged in
  const script = readFileSync(rev.launchCommand.replace(/^bash /, ""), "utf8");
  // full-auto INSIDE the wall (run #7): the bypass flag rides the walled claude
  // launch so an unattended seat never stalls on per-command approvals — and it
  // is INSIDE sandbox-exec, never a substitute for the wall.
  assert.match(script, /sandbox-exec -f '.*reviewer\.sb' claude --model opus --permission-mode bypassPermissions/);
  assert.match(script, /WALLED — P5-0a/);
});

test("claude on a seat with NO loadout REFUSES loudly (never unwalled)", async () => {
  const proj = makeProject(brain, 'CODER_AGENT="claude"; CODER_MODEL="opus"\n');
  await assert.rejects(
    planSeats(proj, { brainRoot: brain, home: HOME, preflight: false }),
    /REFUSING to launch.*no loadout.*unwalled claude/s,
  );
});

test("non-claude adapter seats stay UNWALLED (script carries only the cwd pin)", async () => {
  const proj = makeProject(brain, 'CODER_AGENT="hermes"; CODER_MODEL=""\nREVIEWER_AGENT="hermes"; REVIEWER_MODEL=""\n');
  const { seats } = await planSeats(proj, { brainRoot: brain, home: HOME, preflight: false });
  const coder = seats.find((s) => s.seat === "coder")!;
  // P7-T1 cwd pin: the fallback launches via a script that cds to the project
  // root — but the wall posture is unchanged: no profile, no sandbox-exec.
  const script = readFileSync(coder.launchCommand.replace(/^bash /, ""), "utf8");
  assert.match(script, /exec hermes-tui/);
  assert.doesNotMatch(script, /sandbox-exec/);
  assert.equal(coder.profilePath, undefined);
});
