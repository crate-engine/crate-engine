// FLAWS "crate team ignores ~/.crate/defaults.yaml" (team-defaults, proof run
// 2026-08): both headless CLI paths (`crate runner` AND `crate team`) hand-
// rolled staffing as `rig.conf[key] || "pi"` — so a fresh rig.conf staffed
// bare pi with NO model (→ the harness's ACCOUNT default), while `crate
// print`, doctor, and the GUI staffing screen all displayed the canonical
// chain (rig.conf → user default → loadout floor). AGGRAVATOR: the GUI's team
// boot spawns `crate runner <seat>` per seat, so the GUI's staffing SCREEN
// promised a roster its own spawned runners ignored. The fix routes both
// commands through launcher.resolveRigSeats — these tests drive the helper's
// chain (unit) and the REAL shipped cli.js as a child process (end-to-end,
// with an overridden HOME, since cli.ts reads HOME at module top).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveRigSeats } from "../src/launcher.js";

const scratch = mkdtempSync(join(tmpdir(), "crate-teamdefaults-"));

/** A fake pristine brain: a coder loadout carrying the floor model, and a
 * bin/ dir for the rig's .agents/bin symlink (deriveBrainRoot resolves the
 * link's real parent — the brain root). */
function makeBrain(): string {
  const brain = join(scratch, "brain");
  mkdirSync(join(brain, "config", "loadouts"), { recursive: true });
  mkdirSync(join(brain, "bin"), { recursive: true });
  writeFileSync(join(brain, "config", "coder.md"), "# coder binder\n");
  writeFileSync(
    join(brain, "config", "loadouts", "coder.yaml"),
    [
      "seat: coder",
      "binder: config/coder.md",
      "policy:",
      "  tools: read,bash",
      "  default_model: floor/model-5",
      "  sandbox: readonly",
    ].join("\n"),
  );
  return brain;
}

const brain = makeBrain();
let rigN = 0;

function makeRig(rigConf: string, opts: { bin?: boolean } = {}): string {
  const proj = join(scratch, `rig-${rigN++}`);
  mkdirSync(join(proj, ".agents"), { recursive: true });
  writeFileSync(join(proj, ".agents", "rig.conf"), rigConf);
  if (opts.bin !== false) symlinkSync(join(brain, "bin"), join(proj, ".agents", "bin"));
  return proj;
}

let homeN = 0;
function makeHome(defaultsYaml?: string): string {
  const home = join(scratch, `home-${homeN++}`);
  mkdirSync(join(home, ".crate"), { recursive: true });
  if (defaultsYaml !== undefined) writeFileSync(join(home, ".crate", "defaults.yaml"), defaultsYaml);
  return home;
}

const DEFAULTS = [
  "seats:",
  "  coder:",
  "    agent: pi",
  "    model: user/model-coder",
  "  reviewer:",
  "    model: user/model-reviewer",
].join("\n");

// (a) THE flaw's repro: fresh rig.conf + a defaults.yaml → the user-default
// roster, not bare pi on the account default.
test("fresh rig.conf resolves the user-default roster (the FLAWS repro)", () => {
  const seats = resolveRigSeats(makeRig('PROJECT="x"\n'), makeHome(DEFAULTS));
  const coder = seats.find((s) => s.seat === "coder")!;
  assert.deepEqual(coder, {
    seat: "coder",
    agent: "pi",
    model: "user/model-coder",
    agentSource: "user default",
    modelSource: "user default",
  });
  // a seat with only a model default keeps the built-in agent
  const reviewer = seats.find((s) => s.seat === "reviewer")!;
  assert.equal(reviewer.agent, "pi");
  assert.equal(reviewer.agentSource, "built-in");
  assert.equal(reviewer.model, "user/model-reviewer");
  assert.equal(reviewer.modelSource, "user default");
});

// (b) precedence is untouched: rig.conf still wins over the user default.
test("rig.conf keys beat the user default", () => {
  const rig = makeRig('CODER_AGENT="hermes"; CODER_MODEL="rig/model-9"\n');
  const coder = resolveRigSeats(rig, makeHome(DEFAULTS)).find((s) => s.seat === "coder")!;
  assert.equal(coder.agent, "hermes");
  assert.equal(coder.agentSource, "rig.conf");
  assert.equal(coder.model, "rig/model-9");
  assert.equal(coder.modelSource, "rig.conf");
});

// (c) nothing in rig.conf or defaults.yaml → the loadout floor speaks for the
// model (the old code lost this too: it never loaded the loadout at all).
test("no rig.conf key / no defaults.yaml → loadout floor model + built-in pi", () => {
  const coder = resolveRigSeats(makeRig('PROJECT="x"\n'), makeHome()).find((s) => s.seat === "coder")!;
  assert.equal(coder.agent, "pi");
  assert.equal(coder.agentSource, "built-in");
  assert.equal(coder.model, "floor/model-5");
  assert.equal(coder.modelSource, "loadout floor");
  // a seat with NO loadout and no default has no model — login/account picks
  const orch = resolveRigSeats(makeRig('PROJECT="x"\n'), makeHome()).find((s) => s.seat === "orchestrator")!;
  assert.equal(orch.model, undefined);
  assert.equal(orch.modelSource, "built-in");
});

// (d) existence-beats-emptiness: MODEL="" is the explicit "let /login pick",
// mapped to undefined (the runner's no-model-flag semantics).
test('rig.conf MODEL="" → model undefined with rig.conf provenance', () => {
  const rig = makeRig('CODER_MODEL=""\n');
  const coder = resolveRigSeats(rig, makeHome(DEFAULTS)).find((s) => s.seat === "coder")!;
  assert.equal(coder.model, undefined);
  assert.equal(coder.modelSource, "rig.conf");
});

// (e) a rig with no .agents/bin (no derivable brain) still resolves rig.conf +
// user defaults — the loadout floor is simply absent, and runner/team keep
// their historical failure modes instead of a brand-new refusal here.
test("missing .agents/bin: rig.conf + defaults still resolve, no throw", () => {
  const rig = makeRig('PROJECT="x"\n', { bin: false });
  const seats = resolveRigSeats(rig, makeHome(DEFAULTS));
  const coder = seats.find((s) => s.seat === "coder")!;
  assert.equal(coder.model, "user/model-coder");
  assert.equal(coder.modelSource, "user default");
  // no brain → no floor: an undefaulted seat has no model at all
  const orch = seats.find((s) => s.seat === "orchestrator")!;
  assert.equal(orch.model, undefined);
});

// (f) an invalid defaults.yaml throws in plain words (same posture as
// planSeats) — silently ignoring it would boot a roster the user overrode.
test("invalid defaults.yaml throws instead of silently falling back", () => {
  const home = makeHome("seats:\n  coder:\n    bogus: 1\n");
  assert.throws(() => resolveRigSeats(makeRig('PROJECT="x"\n'), home), /defaults\.yaml is not valid/);
});

// ── End-to-end: the REAL shipped cli.js (reproduce-first rule) ──────────────
// cli.ts reads HOME from process.env at module top, so only a child process
// with an overridden HOME proves the actual binary path end to end.

const cliJs = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/** Run cli.js, resolving with collected stdout+stderr. `until` short-circuits
 * long-lived commands (crate team never exits on its own) by killing the
 * child once the expected output has appeared. */
function runCli(args: string[], home: string, until?: RegExp): Promise<{ out: string; code: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliJs, ...args], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli.js ${args.join(" ")} timed out; output so far:\n${out}`));
    }, 30_000);
    const onChunk = (c: Buffer) => {
      out += c.toString();
      if (until?.test(out)) child.kill("SIGKILL"); // seen enough — the loop would run forever
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ out, code });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

test("S4: a standalone `crate runner` on a blended-by-default seat REFUSES and teaches the opt-out", async () => {
  const rig = makeRig('PROJECT="x"\n'); // no opt-out → the seat blends by default
  const home = makeHome(DEFAULTS);
  const { out, code } = await runCli(["runner", "coder", "--project", rig, "--once"], home);
  assert.notEqual(code, 0, "a second consumer on a blended seat's inbox must refuse");
  assert.match(out, /BLENDED \(the default/, out);
  assert.match(out, /BLEND_CODER=0/, "the refusal teaches the per-seat opt-out");
});

test("e2e: `crate runner --once` boots the user-default staffing with provenance", async () => {
  const rig = makeRig('PROJECT="x"\nBLEND_CODER=0\n'); // S4: opted out = the sanctioned headless run
  const home = makeHome(DEFAULTS);
  const { out, code } = await runCli(["runner", "coder", "--project", rig, "--once"], home);
  assert.equal(code, 0, `runner exited ${code}:\n${out}`);
  assert.match(
    out,
    /crate runner — coder headless \(pi\/user\/model-coder \[agent: user default, model: user default\], unwalled\)/,
    `boot line must carry the defaults roster with provenance:\n${out}`,
  );
  assert.match(out, /idle \(no unread mail\)/);
});

test("e2e: `crate team` seat table shows the user-default roster, not bare pi", async () => {
  const rig = makeRig('PROJECT="x"\n');
  const home = makeHome(DEFAULTS);
  // the tester row is the last of the five seat lines — once it prints, the
  // staffing table is complete and the standing loops can be killed
  const { out } = await runCli(["team", "--project", rig], home, /tester\s+pi/);
  assert.match(out, /coder\s+pi\/user\/model-coder \[agent: user default, model: user default\]\s+\[unwalled\]/, out);
  assert.match(out, /reviewer\s+pi\/user\/model-reviewer \[agent: built-in, model: user default\]/, out);
});
