import { type AgentProblem } from "./detect.js";
export type CheckStatus = "ok" | "warn" | "info";
export interface CheckResult {
    name: string;
    status: CheckStatus;
    detail: string;
    /** The one actionable line shown on a warn. */
    fix?: string;
}
export declare function runDoctor(projectRoot: string): Promise<CheckResult[]>;
/** Detection problems for the rig's STAFFED agents (dedup by agent). */
export declare function rigAuthProblems(projectRoot: string, home: string): AgentProblem[];
export interface HeavyDep {
    seat: string;
    name: string;
    check: string;
    install: string;
    /** Plain-words purpose from the loadout (shown to the user by the box). */
    why?: string;
}
/** Heavy deps declared by the rig's loadouts whose check currently FAILS (dedup by install). */
export declare function heavyDeps(projectRoot: string): Promise<HeavyDep[]>;
/** Run the disclosed installs (after user confirmation); re-check each. */
export declare function installHeavyDeps(deps: HeavyDep[]): Promise<Array<{
    name: string;
    ok: boolean;
    detail: string;
}>>;
export declare function formatDoctor(results: CheckResult[]): string;
