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
import { isUnwalledSeat, planSeats } from "../src/launcher.js";

// FLAWS "Codex CLI seats launch UNWALLED with approvals bypassed": a codex
// seat now takes the SAME walled v1-adapter branch as claude (P5-0a) — the
// seat's OWN loadout wall + the codex state doors, with the dangerous
// approvals-bypass flag applied by the LAUNCHER, only ever against a rendered
// profile (the P4-12 runtime belt). An unwallable codex seat REFUSES. These
// tests drive the REAL planSeats.

const scratch = mkdtempSync(join(tmpdir(), "crate2-walled-codex-"));
const HOME = join(scratch, "home");
mkdirSync(HOME, { recursive: true });

/** A minimal brain: reviewer loadout (readonly wall) + a sandbox: none seat. */
function makeBrain(): string {
  const brain = join(scratch, "brain");
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  mkdirSync(join(brain, "config", "sandbox"), { recursive: true });
  writeFileSync(join(brain, "config", "reviewer.md"), "# reviewer binder\n");
  writeFileSync(join(brain, "config", "designer.md"), "# designer binder\n");
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
  writeFileSync(
    join(brain, "config", "loadouts", "designer.yaml"),
    [
      "seat: designer",
      "binder: config/designer.md",
      "policy:",
      "  tools: read,bash",
      "  default_model: openai-codex/gpt-5.5",
      "  sandbox: none",
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

/** A minimal attached project with a codex adapter and a staffing conf. */
let projSeq = 0;
function makeProject(brain: string, rigConf: string): string {
  const proj = join(scratch, `proj-${projSeq++}`);
  mkdirSync(join(proj, ".agents"), { recursive: true });
  symlinkSync(join(brain, "config"), join(proj, ".agents", "config"));
  writeFileSync(join(proj, ".agents", "rig.conf"), rigConf);
  // the REAL adapter shape post-fix: launch.sh echoes a SAFE codex line (no
  // bypass flag) — the launcher owns the flag, wall-gated.
  for (const [agent, line] of [
    ["codex", 'codex${1:+ --model $1}'],
    ["pi", 'pi --model ${1:-default}'],
    ["hermes", "hermes-tui"],
  ] as const) {
    mkdirSync(join(proj, ".agents", "adapters", agent), { recursive: true });
    const launch = join(proj, ".agents", "adapters", agent, "launch.sh");
    writeFileSync(launch, `#!/usr/bin/env bash\necho "${line}"\n`);
    chmodSync(launch, 0o755);
  }
  return proj;
}

const brain = makeBrain();

test("adapter-codex on a walled loadout: profile rendered + sandbox-exec wrap + codex doors + launcher-owned bypass", async () => {
  const proj = makeProject(brain, 'REVIEWER_AGENT="codex"; REVIEWER_MODEL=""\n');
  const { seats } = await planSeats(proj, { brainRoot: brain, home: HOME, preflight: false });
  const rev = seats.find((s) => s.seat === "reviewer")!;
  assert.equal(rev.staffed.agent, "codex");
  assert.equal(rev.manifestDriven, false); // still the v1-adapter launch line…
  assert.equal(rev.sandbox, "readonly"); // …but the seat's OWN wall applies
  assert.ok(rev.profilePath && existsSync(rev.profilePath));
  const profile = readFileSync(rev.profilePath!, "utf8");
  assert.match(profile, /readonly wall/);
  assert.match(profile, /\.codex/); // the codex state door merged in
  const script = readFileSync(rev.launchCommand.replace(/^bash /, ""), "utf8");
  // The dangerous flag rides ONLY the walled launch (launcher-applied): codex's
  // own approvals/sandbox are off INSIDE sandbox-exec — the wall is the
  // containment (and codex's own Seatbelt cannot nest inside ours anyway).
  assert.match(
    script,
    /sandbox-exec -f '.*reviewer\.sb' codex --dangerously-bypass-approvals-and-sandbox/,
  );
  assert.match(script, /WALLED/);
});

test("codex on a seat with NO loadout REFUSES loudly (never unwalled)", async () => {
  const proj = makeProject(brain, 'CODER_AGENT="codex"; CODER_MODEL=""\n');
  await assert.rejects(
    planSeats(proj, { brainRoot: brain, home: HOME, preflight: false }),
    /REFUSING to launch.*no loadout.*unwalled codex/s,
  );
});

test("codex on a sandbox: none loadout REFUSES loudly", async () => {
  const proj = makeProject(brain, 'DESIGNER_AGENT="codex"; DESIGNER_MODEL=""\n');
  await assert.rejects(
    planSeats(proj, { brainRoot: brain, home: HOME, preflight: false }),
    /REFUSING to launch.*sandbox: none.*unwalled codex/s,
  );
});

test("isUnwalledSeat covers codex exactly like claude; other agents untouched", () => {
  const walled = (sandbox: string) => ({ policy: { sandbox } });
  assert.ok(isUnwalledSeat("codex", undefined));
  assert.ok(isUnwalledSeat("codex", walled("none")));
  assert.ok(!isUnwalledSeat("codex", walled("readonly")));
  assert.ok(!isUnwalledSeat("codex", walled("standard")));
  assert.ok(isUnwalledSeat("claude", undefined)); // the P5-0a predicate, unchanged
  assert.ok(!isUnwalledSeat("pi", undefined));
  assert.ok(!isUnwalledSeat("hermes", undefined));
});
