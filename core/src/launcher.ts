// Seat launch PLANNING (planSeats): resolve staffing per seat and render each
// seat's walled launch command + Seatbelt profile. T8: the cmux boot (`up`)
// was removed — the GUI-owned headless lifecycle (gui/teamproc.ts) boots the
// team now; planSeats stays as the shared staffing/wall renderer (used by
// `crate print` and the walling machinery).
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadLoadout, loadoutPath, SEATS, type Loadout, type Seat } from "./manifest.js";
import { buildInvocation, toShellCommand } from "./invocation.js";
import { composedBrainRoot, overlayDirFor } from "./overlay.js";
import { specFromLoadout, stateDoorsFor, writeProfile } from "./sandbox.js";
import {
  loadUserDefaults,
  parseRigConf,
  resolveSeat,
  resolveSeatDetailed,
  RIG_PREFIX,
  type Staffed,
  type StaffingSource,
} from "./staffing.js";

const execFileP = promisify(execFile);

/**
 * P4-12: per-agent flag syntax for a declared permission posture — DATA, not
 * launcher logic (no agent special-case in the launch path). A wrapped
 * claude-code seat's in-TUI approval prompt is redundant friction inside the
 * wall (P3-11c finding); agents with no flag entry simply get none.
 */
const PERMISSION_FLAGS: Record<string, Partial<Record<string, string>>> = {
  "claude-code": { bypassPermissions: " --permission-mode bypassPermissions" },
  // Codex's flag folds approvals AND its own sandbox into one switch. Off is
  // required inside our wall regardless: codex's own macOS sandbox is Seatbelt
  // too, and Seatbelt does not nest — the crate wall is the containment
  // (identical posture to claude's bypassPermissions above).
  codex: { bypassPermissions: " --dangerously-bypass-approvals-and-sandbox" },
};

/**
 * The runtime half of the security coupling (belt-and-suspenders with the
 * schema): "bypassPermissions" is applied ONLY when a Seatbelt profile was
 * actually rendered — the wall IS the containment. No profile → refuse loudly.
 */
export function permissionFlag(
  agent: string,
  mode: string,
  profilePath: string | undefined,
): string {
  if (mode !== "bypassPermissions") return "";
  if (!profilePath) {
    throw new Error(
      `REFUSING to launch: permission_mode "bypassPermissions" with no rendered sandbox profile — ` +
        `a bypass seat without a wall is impossible by construction (P4-12 runtime belt).`,
    );
  }
  return PERMISSION_FLAGS[agent]?.[mode] ?? "";
}

export interface SeatPlan {
  seat: Seat;
  title: string;
  staffed: Staffed;
  /** The one line typed into the pane to launch this seat. */
  launchCommand: string;
  /** True when the command came from a loadout manifest (the 2.0 path). */
  manifestDriven: boolean;
  /** Manifest policy.sandbox for manifest seats ("readonly"/"standard"/"none"). */
  sandbox?: string;
  /** Rendered Seatbelt profile wrapping this seat (absent = unwrapped). */
  profilePath?: string;
  surface?: string;
}

/**
 * v1-adapter agents that MUST launch behind a rendered wall (P5-0a claude;
 * FLAWS "codex-seat walling" codex), mapped to the harness key used for their
 * state doors + permission flag. Not listed (pi/hermes/…) = fallback branch.
 */
const WALLED_V1_AGENTS: Record<string, string> = { claude: "claude-code", codex: "codex" };

/**
 * P5-0a structural tripwire (was the C-interim warning predicate): since
 * TASK-0, EVERY engine-launched claude seat is walled — the adapter branch
 * renders the seat's own loadout wall, and a claude seat that cannot be walled
 * (no loadout, or `sandbox: none`) REFUSES to launch. Codex joined the same
 * rule (FLAWS "codex-seat walling": its adapter used to carry the
 * approvals-bypass flag UNWALLED). This predicate flags exactly those
 * refuse-at-boot staffings so doctor can name them BEFORE a boot attempt; it
 * firing for any launchable configuration would mean a regression
 * reintroduced an unwalled claude/codex branch.
 */
export function isUnwalledSeat(
  staffedAgent: string,
  loadout: { policy: { sandbox: string } } | undefined,
): boolean {
  return staffedAgent in WALLED_V1_AGENTS && (loadout === undefined || loadout.policy.sandbox === "none");
}

/**
 * P3-1 fail-loud preflight: every manifest cli_deps.check must pass WITH the
 * seat's PATH before we launch — a missing first-choice tool REFUSES the boot
 * instead of letting the seat silently fall back (the Phase-2 raw-CDP lesson).
 */
export async function preflightCliDeps(
  loadout: Loadout,
  title: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const missing: string[] = [];
  for (const dep of loadout.cli_deps) {
    try {
      await execFileP("bash", ["-c", dep.check], { env });
    } catch {
      missing.push(dep.install ? `${dep.name} (install: ${dep.install})` : dep.name);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `REFUSING to launch ${title}: missing cli_deps — ${missing.join("; ")}. ` +
        `Fail-loud by design (P3-1): install the tool(s); the seat does not boot with silent fallbacks.`,
    );
  }
}

/** One seat's fully resolved headless staffing, with provenance. */
export interface ResolvedRigSeat {
  seat: Seat;
  agent: string;
  /** undefined = no model flag — the harness's login/account default picks
   * (the runner semantics for both "nothing resolved" and an explicit ""). */
  model: string | undefined;
  agentSource: StaffingSource;
  modelSource: StaffingSource;
}

/**
 * Resolve headless staffing for EVERY seat through the ONE canonical chain
 * (rig.conf → ~/.crate/defaults.yaml → loadout floor), with provenance.
 *
 * This exists because `crate runner` and `crate team` used to hand-roll
 * `rig.conf[key] || "pi"` — so a fresh rig.conf silently staffed bare pi on
 * the ACCOUNT default model while `crate print`, doctor, and the GUI staffing
 * screen all displayed the defaults-aware roster (FLAWS "crate team ignores
 * ~/.crate/defaults.yaml"). The GUI's team boot spawns `crate runner` per
 * seat, so this helper is the runtime truth for GUI-booted teams too.
 */
export function resolveRigSeats(projectRoot: string, home: string): ResolvedRigSeat[] {
  const confFile = join(projectRoot, ".agents", "rig.conf");
  const conf = existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
  // An invalid defaults.yaml THROWS in plain words (same posture as planSeats):
  // silently ignoring it would staff a roster the user explicitly overrode.
  const userDefaults = loadUserDefaults(home);
  // Loadout floor comes from the PRISTINE brain (mirrors `crate print`). A rig
  // without .agents/bin cannot derive one — proceed with loadout=undefined so
  // runner/team keep their historical failure modes (rig.conf + defaults still
  // resolve; any missing-brain error surfaces later exactly where it used to).
  let brainRoot: string | undefined;
  try {
    brainRoot = deriveBrainRoot(projectRoot);
  } catch {
    brainRoot = undefined;
  }
  return SEATS.map((seat) => {
    const loadout =
      brainRoot !== undefined && existsSync(loadoutPath(brainRoot, seat))
        ? loadLoadout(brainRoot, seat)
        : undefined;
    const d = resolveSeatDetailed(seat, loadout, { rigConf: conf, userDefaults });
    return {
      seat,
      agent: d.agent.value,
      model: d.model.value === "" ? undefined : d.model.value,
      agentSource: d.agent.source,
      modelSource: d.model.source,
    };
  });
}

/**
 * ONE seat's staffing through the canonical chain — the RUNTIME door.
 *
 * CE-141: the blended-pane path (S4, now the default for eligible seats) was
 * hand-rolling `rig.conf[key] || "pi"` again, the exact shortcut resolveRigSeats
 * was written to retire. A rig whose rig.conf names no agent — i.e. EVERY
 * freshly attached rig, since attach writes those lines commented out — booted
 * bare pi on the account-default model while the staffing screen, `crate print`
 * and /api/staffing all showed the user's real default. Runtime and display
 * disagreed, and the user's own model choice lost silently.
 *
 * `home` is explicit because the user-defaults layer lives there: callers that
 * cannot name a home (tests, legacy paths) get the conf-only resolution they
 * always had rather than whatever ~/.crate holds on the machine running them.
 */
export function resolveSeatStaffing(
  projectRoot: string,
  seat: Seat,
  home: string | undefined,
  conf?: Record<string, string>,
): { agent: string; model?: string } {
  if (home === undefined) {
    const c = conf ?? {};
    const agent = c[`${RIG_PREFIX[seat]}_AGENT`] || "pi";
    const model = c[`${RIG_PREFIX[seat]}_MODEL`] || undefined;
    return { agent, model };
  }
  const r = resolveRigSeats(projectRoot, home).find((s) => s.seat === seat);
  return { agent: r?.agent ?? "pi", model: r?.model };
}

export function deriveBrainRoot(projectRoot: string): string {
  // .agents/bin is a symlink into the brain; its target's parent IS the brain.
  const binLink = join(projectRoot, ".agents", "bin");
  if (!existsSync(binLink)) {
    throw new Error(`${projectRoot} has no .agents/bin — is the engine attached? (crate install)`);
  }
  return resolve(realpathSync(binLink), "..");
}

/** v1 adapter contract: launch.sh <model> <project> → echoes one command line. */
async function adapterLaunchCommand(
  projectRoot: string,
  agent: string,
  model: string,
): Promise<string> {
  const script = join(projectRoot, ".agents", "adapters", agent, "launch.sh");
  if (!existsSync(script)) {
    throw new Error(`no adapter launch script for agent "${agent}" (looked for ${script})`);
  }
  const { stdout } = await execFileP("bash", [script, model, basename(projectRoot)]);
  const line = stdout.trim().split("\n").pop() ?? "";
  if (!line) throw new Error(`${script} echoed nothing`);
  return line;
}

/**
 * Plan every seat's launch. Manifest path when the staffed agent is "pi" AND
 * the seat has a loadout manifest; otherwise the seat launches exactly as v1
 * did (mixed-team compatibility — Phase 2 flips seats one at a time).
 */
export async function planSeats(
  projectRoot: string,
  opts: { brainRoot?: string; home?: string; preflight?: boolean } = {},
): Promise<{ seats: SeatPlan[]; conf: Record<string, string>; brainRoot: string; scriptDir: string }> {
  const pristineBrain = opts.brainRoot ?? deriveBrainRoot(projectRoot);
  const confFile = join(projectRoot, ".agents", "rig.conf");
  if (!existsSync(confFile)) throw new Error(`no rig.conf at ${confFile} — run crate install first`);
  const conf = parseRigConf(readFileSync(confFile, "utf8"));
  const homeForTier = opts.home ?? process.env.HOME ?? "";
  const userDefaults = loadUserDefaults(homeForTier);

  const titles: Record<Seat, string> = {
    orchestrator: conf.ORCH_TITLE || "Orchestrator",
    coder: conf.CODER_TITLE || "Coder",
    reviewer: conf.REVIEWER_TITLE || "Reviewer",
    designer: conf.DESIGNER_TITLE || "Designer",
    tester: conf.TESTER_TITLE || "QA",
  };

  const scriptDir = mkdtempSync(join(tmpdir(), "crate2-launch-"));

  // P4-5: seats consume ONLY the composed brain view (pristine clone + the
  // user's ~/.crate/overlay). No overlay entries → the pristine root itself.
  const brainRoot = composedBrainRoot(pristineBrain, overlayDirFor(homeForTier), scriptDir);
  const seats: SeatPlan[] = [];

  // P3-1 seat PATH: first-choice tools (qa-sweep, sandbox-test, …) resolve by
  // NAME inside every manifest seat; the same PATH is what preflight checks.
  const coreTools = join(brainRoot, "core", "tools");
  const seatEnv = { ...process.env, PATH: `${coreTools}:${process.env.PATH ?? ""}` };
  // Seatbelt matches RESOLVED paths — render profiles against the real project.
  const realProject = realpathSync(projectRoot);
  const home = homeForTier;

  for (const seat of SEATS) {
    const hasManifest = existsSync(loadoutPath(brainRoot, seat));
    const loadout: Loadout | undefined = hasManifest ? loadLoadout(brainRoot, seat) : undefined;
    const staffed = resolveSeat(seat, loadout, { rigConf: conf, userDefaults });

    let launchCommand: string;
    let manifestDriven = false;
    let sandbox: string | undefined;
    let profilePath: string | undefined;

    // Manifest path: pi seats build the full invocation from the loadout; a
    // claude-code seat (P3-8, the first non-Pi manifest seat) takes its launch
    // line from the v1 claude adapter and the manifest contributes the WALL
    // (sandbox policy + doors + deps). Anything else launches exactly as v1.
    const isPiManifest = staffed.agent === "pi" && loadout?.agent === "pi";
    const isClaudeManifest = staffed.agent === "claude" && loadout?.agent === "claude-code";

    if (loadout && (isPiManifest || isClaudeManifest)) {
      if (opts.preflight !== false) await preflightCliDeps(loadout, titles[seat], seatEnv);
      if (home === "") throw new Error("cannot render a sandbox profile without HOME");
      sandbox = loadout.policy.sandbox;
      const spec = specFromLoadout(loadout);
      spec.doors = [...spec.doors, ...stateDoorsFor(loadout.agent)];
      profilePath = writeProfile(spec, { brainRoot, projectRoot: realProject, home }, scriptDir);
      let inner = isPiManifest
        ? toShellCommand(buildInvocation(loadout, staffed, { brainRoot, projectRoot }))
        : await adapterLaunchCommand(projectRoot, staffed.agent, staffed.model);
      // P4-12: the permission posture comes from the DECLARED loadout field
      // (schema already refuses bypass-without-wall); the runtime belt below
      // re-checks the rendered profile before the flag is ever applied.
      inner += permissionFlag(loadout.agent, loadout.policy.permission_mode, profilePath);
      // Long invocations are delivered as a tiny script file, not a long cmux
      // send (the documented truncation trap). The pane runs `bash <file>`.
      // The script exports the seat PATH, then wraps the harness in its wall.
      const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
      const wrap = profilePath ? `sandbox-exec -f ${q(profilePath)} ` : "";
      // CRATE_WALLED (FLAWS "browser-tooling"): tell in-box tools they run
      // inside a wall — the agent-browser shim keys chromium's --no-sandbox
      // injection off it (nested sandbox init is refused by the OS, so the
      // outer wall must BE the containment). Only exported when a profile was
      // actually rendered; an unwalled seat keeps chromium's own sandbox.
      const walledEnv = profilePath ? `export CRATE_WALLED=1\n` : "";
      const script = join(scriptDir, `${seat}.sh`);
      writeFileSync(
        script,
        `#!/usr/bin/env bash\n# crate2 launch: ${seat} (manifest-driven ${loadout.agent}; sandbox: ${sandbox})\nexport PATH=${q(coreTools)}:"$PATH"\n${walledEnv}cd ${q(projectRoot)}\nexec ${wrap}${inner}\n`,
      );
      chmodSync(script, 0o755);
      launchCommand = `bash ${script}`;
      manifestDriven = true;
    } else if (staffed.agent in WALLED_V1_AGENTS) {
      // P5-0a (TASK-0, Option B), extended to codex (FLAWS "codex-seat
      // walling"): an adapter-launched claude/codex seat is WALLED — the
      // seat's OWN loadout sandbox policy + the harness's state doors, the
      // adapter's launch line wrapped in sandbox-exec exactly like the
      // manifest path. The harness's own approvals-bypass posture (claude:
      // host config may inject bypassPermissions — the P4-14 find; codex: the
      // launcher applies --dangerously-bypass-approvals-and-sandbox below) is
      // what makes the wall REQUIRED: no engine-launched claude/codex, ever,
      // without a rendered wall — so a seat that CANNOT be walled refuses.
      const harness = WALLED_V1_AGENTS[staffed.agent]!;
      if (!loadout) {
        throw new Error(
          `REFUSING to launch ${titles[seat]}: ${staffed.agent} is staffed on a seat with no loadout manifest, ` +
            `so no sandbox wall can be rendered — and an unwalled ${staffed.agent} seat is not allowed ` +
            `(the harness runs with its own approvals bypassed; FLAWS "unwalled claude seats" / "codex-seat walling"). ` +
            `Add a loadout for the seat or staff a different agent.`,
        );
      }
      if (loadout.policy.sandbox === "none") {
        throw new Error(
          `REFUSING to launch ${titles[seat]}: ${staffed.agent} is staffed on a seat whose loadout declares ` +
            `sandbox: none — an unwalled ${staffed.agent} seat is not allowed (FLAWS "unwalled claude seats" / ` +
            `"codex-seat walling"). Staff a walled seat or change the loadout's sandbox policy.`,
        );
      }
      if (home === "") throw new Error("cannot render a sandbox profile without HOME");
      sandbox = loadout.policy.sandbox;
      const spec = specFromLoadout(loadout);
      spec.doors = [...spec.doors, ...stateDoorsFor(harness)];
      profilePath = writeProfile(spec, { brainRoot, projectRoot: realProject, home }, scriptDir)!;
      let inner = await adapterLaunchCommand(projectRoot, staffed.agent, staffed.model);
      // Full-auto posture (run #7 ask): bypass the harness's own per-command
      // approval prompts so an unattended seat never stalls. SAFE here by
      // construction — this branch has ALREADY rendered a wall (refuses above
      // without one), so the bypass runs INSIDE the Seatbelt profile (the
      // P4-12/P4-14 coupling: the wall is the containment, not the in-TUI
      // prompt). For codex this is also the ONLY workable shape: its own
      // sandbox is Seatbelt too, and Seatbelt does not nest.
      inner += permissionFlag(harness, "bypassPermissions", profilePath);
      const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
      const script = join(scriptDir, `${seat}.sh`);
      writeFileSync(
        script,
        `#!/usr/bin/env bash\n# crate2 launch: ${seat} (v1-adapter ${staffed.agent}, WALLED — P5-0a; sandbox: ${sandbox})\nexport PATH=${q(coreTools)}:"$PATH"\nexport CRATE_WALLED=1\ncd ${q(projectRoot)}\nexec sandbox-exec -f ${q(profilePath)} ${inner}\n`,
      );
      chmodSync(script, 0o755);
      launchCommand = `bash ${script}`;
    } else {
      // Fallback (v1-adapter, incl. CROSS-STAFFED seats — e.g. pi on a
      // claude-code loadout): the raw command used to ride the pane's
      // inherited cwd, so the agent's file tools aimed at the WRONG repo
      // (the P7-T1 live-loop find). Same script shape as the other branches
      // pins cwd to the project root; these harnesses run their own approval
      // prompts (no bypass flag rides this branch), so no wall is forced.
      const inner = await adapterLaunchCommand(projectRoot, staffed.agent, staffed.model);
      const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
      const script = join(scriptDir, `${seat}.sh`);
      writeFileSync(
        script,
        `#!/usr/bin/env bash\n# crate2 launch: ${seat} (v1 adapter, unwalled; cwd pinned to the project)\ncd ${q(projectRoot)}\nexec ${inner}\n`,
      );
      chmodSync(script, 0o755);
      launchCommand = `bash ${script}`;
    }

    seats.push({ seat, title: titles[seat], staffed, launchCommand, manifestDriven, sandbox, profilePath });
  }

  return { seats, conf, brainRoot, scriptDir };
}

