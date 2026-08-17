// PHASE-8 T6 — the headless wall: every runner turn launches inside the
// seat's declared wall, on both platforms (Seatbelt on macOS, bwrap on
// Linux — renderWallPlan is the D7 seam). This carries the P5-0a/P8 walling
// law onto the runner path: claude/codex run with their own approvals
// bypassed, so an engine-launched claude/codex turn WITHOUT a rendered wall
// is not allowed, ever — a seat that cannot be walled REFUSES, in plain
// words. pi seats mirror cmux-mode manifest behavior: walled when the seat's
// loadout declares a policy, unwalled on a loadout-less scratch rig.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadLoadout, loadoutPath, loadProjectDoors } from "./manifest.js";
import { renderWallPlan, specFromLoadout, stateDoorsFor } from "./sandbox.js";
/** Harnesses that may NEVER run unwalled (their approvals are bypassed). */
const WALL_REQUIRED = { claude: "claude-code", codex: "codex" };
/**
 * Normalize a staffed-agent string to its wall/adapter key. rig.conf uses the
 * short form (`claude`, `codex`, `pi`) but a loadout's `agent:` field spells
 * claude `claude-code`; if a rig.conf ever carries the long form, fold it back
 * so the refusal law (WALL_REQUIRED) and the adapter dispatch see the same key
 * — otherwise `claude-code` reads as an unknown, non-required agent and the
 * plain-words refusal never fires (fail-safe only via the adapter's throw).
 */
export function normalizeAgent(agent) {
    if (agent === "claude-code")
        return "claude";
    return agent;
}
// An INSTALLED bwrap can still be non-functional: Ubuntu 23.10+ restricts
// unprivileged user namespaces via AppArmor, and bwrap fails at "setting up
// uid map: Permission denied" only at RUN time. Probe once per process so the
// refusal happens at boot, in plain words, with the exact fix — never as an
// opaque mid-turn error.
let bwrapProbe;
function assertBwrapFunctional(bin) {
    if (bwrapProbe?.bin !== bin) {
        bwrapProbe = { bin };
        try {
            execFileSync(bin, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "true"], {
                timeout: 10000,
                stdio: "pipe",
            });
        }
        catch (e) {
            bwrapProbe.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
        }
    }
    if (bwrapProbe.error) {
        throw new Error(`bubblewrap is installed but CANNOT create its sandbox on this machine (${bwrapProbe.error}). ` +
            `On Ubuntu 24.04+ this is the unprivileged-user-namespace AppArmor restriction — fix it once, as root:\n` +
            `  sudo tee /etc/apparmor.d/bwrap >/dev/null <<'EOF'\n` +
            `abi <abi/4.0>,\ninclude <tunables/global>\n\n` +
            `profile bwrap ${bin} flags=(unconfined) {\n  userns,\n\n  include if exists <local/bwrap>\n}\nEOF\n` +
            `  sudo apparmor_parser -r /etc/apparmor.d/bwrap\n` +
            `then relaunch the team.`);
    }
}
/**
 * The rig's brain root, resolved through the .agents/config wiring
 * (a symlink to `<brain>/config` on dev rigs, a real dir under
 * ~/.crate/engine on product rigs). undefined when the rig has no config.
 */
export function brainRootFor(projectRoot) {
    const cfg = join(projectRoot, ".agents", "config");
    if (!existsSync(cfg))
        return undefined;
    try {
        return dirname(realpathSync(cfg));
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve the wall for one headless seat. Returns the wrap (argv prefix +
 * backend) plus the policy it renders, undefined for an honestly-unwalled
 * seat (no loadout, or a declared sandbox: none on a non-required agent),
 * and THROWS the refusal for a walled-required agent that cannot be walled.
 */
export function resolveHeadlessWall(projectRoot, seatArg, agentArg, opts = {}) {
    const seat = seatArg;
    const agent = normalizeAgent(agentArg);
    const required = agent in WALL_REQUIRED;
    const brainRoot = brainRootFor(projectRoot);
    const hasLoadout = brainRoot !== undefined && existsSync(loadoutPath(brainRoot, seat));
    if (!hasLoadout) {
        if (required) {
            throw new Error(`REFUSING to run the ${seat} seat headless: ${agent} is staffed with no loadout manifest, so no ` +
                `sandbox wall can be rendered — and an unwalled ${agent} seat is not allowed (the harness runs ` +
                `with its own approvals bypassed; the P8 walling law holds headless). Wire .agents/config to a ` +
                `brain with a ${seat} loadout, or staff a different agent.`);
        }
        return undefined;
    }
    const loadout = loadLoadout(brainRoot, seat);
    if (loadout.policy.sandbox === "none") {
        if (required) {
            throw new Error(`REFUSING to run the ${seat} seat headless: ${agent} on a loadout that declares sandbox: none — ` +
                `an unwalled ${agent} seat is not allowed (the P8 walling law holds headless). ` +
                `Change the loadout's sandbox policy or staff a different agent.`);
        }
        return undefined;
    }
    const spec = specFromLoadout(loadout);
    spec.doors = [...spec.doors, ...stateDoorsFor(WALL_REQUIRED[agent] ?? agent)];
    // CE-117 (Adam's ruling 2026-08-17): a project may WIDEN its own wall —
    // additive doors from <project>/.agents/doors.yaml, merged AFTER the
    // loadout's list (never replacing it), and always printed below: a silent
    // widening is the failure mode that matters. A malformed doors.yaml throws
    // in plain words rather than being silently ignored.
    const projDoors = loadProjectDoors(projectRoot, seat);
    if (projDoors.length > 0) {
        spec.doors = [...spec.doors, ...projDoors];
        console.warn(`[wall] ${seat}: PROJECT doors (additive, from .agents/doors.yaml): ${projDoors.join("  ")}`);
    }
    const home = opts.home ?? homedir();
    const paths = { brainRoot: brainRoot, projectRoot: realpathSync(projectRoot), home };
    const outDir = mkdtempSync(join(tmpdir(), "crate-wall-"));
    const plan = renderWallPlan(spec, paths, outDir, opts); // throws SandboxError when the host has no backend
    // Real runtime only (tests inject platform/bwrapBin): prove bwrap can
    // actually sandbox before trusting the wall — fail at boot, not mid-turn.
    if (plan.backend === "bwrap" && opts.platform === undefined && opts.bwrapBin === undefined) {
        assertBwrapFunctional(plan.argvPrefix[0]);
    }
    if (plan.skippedDoors.length > 0) {
        console.warn(`[wall] ${seat}: door(s) the ${plan.backend} backend cannot express, SKIPPED (writes there will be denied): ` +
            plan.skippedDoors.join("  "));
    }
    if (plan.absentDoors.length > 0) {
        console.warn(`[wall] ${seat}: door(s) not present on disk, bound try-only (writes there are denied until the path exists — ` +
            `sign the harness in / create the path first): ${plan.absentDoors.join("  ")}`);
    }
    return { ...plan, sandbox: loadout.policy.sandbox };
}
//# sourceMappingURL=wall.js.map