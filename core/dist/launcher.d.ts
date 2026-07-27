import { type Loadout, type Seat } from "./manifest.js";
import { type Staffed } from "./staffing.js";
/**
 * The runtime half of the security coupling (belt-and-suspenders with the
 * schema): "bypassPermissions" is applied ONLY when a Seatbelt profile was
 * actually rendered — the wall IS the containment. No profile → refuse loudly.
 */
export declare function permissionFlag(agent: string, mode: string, profilePath: string | undefined): string;
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
export declare function isUnwalledSeat(staffedAgent: string, loadout: {
    policy: {
        sandbox: string;
    };
} | undefined): boolean;
/**
 * P3-1 fail-loud preflight: every manifest cli_deps.check must pass WITH the
 * seat's PATH before we launch — a missing first-choice tool REFUSES the boot
 * instead of letting the seat silently fall back (the Phase-2 raw-CDP lesson).
 */
export declare function preflightCliDeps(loadout: Loadout, title: string, env: NodeJS.ProcessEnv): Promise<void>;
export declare function deriveBrainRoot(projectRoot: string): string;
/**
 * Plan every seat's launch. Manifest path when the staffed agent is "pi" AND
 * the seat has a loadout manifest; otherwise the seat launches exactly as v1
 * did (mixed-team compatibility — Phase 2 flips seats one at a time).
 */
export declare function planSeats(projectRoot: string, opts?: {
    brainRoot?: string;
    home?: string;
    preflight?: boolean;
}): Promise<{
    seats: SeatPlan[];
    conf: Record<string, string>;
    brainRoot: string;
    scriptDir: string;
}>;
