import { type Seat } from "./manifest.js";
import { type WallPlan } from "./sandbox.js";
/**
 * Normalize a staffed-agent string to its wall/adapter key. rig.conf uses the
 * short form (`claude`, `codex`, `pi`) but a loadout's `agent:` field spells
 * claude `claude-code`; if a rig.conf ever carries the long form, fold it back
 * so the refusal law (WALL_REQUIRED) and the adapter dispatch see the same key
 * — otherwise `claude-code` reads as an unknown, non-required agent and the
 * plain-words refusal never fires (fail-safe only via the adapter's throw).
 */
export declare function normalizeAgent(agent: string): string;
/**
 * The rig's brain root, resolved through the .agents/config wiring
 * (a symlink to `<brain>/config` on dev rigs, a real dir under
 * ~/.crate/engine on product rigs). undefined when the rig has no config.
 */
export declare function brainRootFor(projectRoot: string): string | undefined;
/**
 * Resolve the wall for one headless seat. Returns the wrap (argv prefix +
 * backend) plus the policy it renders, undefined for an honestly-unwalled
 * seat (no loadout, or a declared sandbox: none on a non-required agent),
 * and THROWS the refusal for a walled-required agent that cannot be walled.
 */
export declare function resolveHeadlessWall(projectRoot: string, seatArg: Seat | string, agentArg: string, opts?: {
    platform?: NodeJS.Platform;
    home?: string;
    bwrapBin?: string;
}): (WallPlan & {
    sandbox: string;
}) | undefined;
