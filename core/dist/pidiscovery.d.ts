import type { Seat } from "./manifest.js";
export interface DiscoveredModel {
    agent: "pi";
    /** provider/id — the exact string Pi's --model takes. */
    model: string;
    display: string;
    billing: string;
    verifiedFor: Seat[];
    /** marks the entry as discovery-sourced (the page tags it "detected"). */
    discovered: true;
    ready: boolean;
    fix?: string;
}
export declare function discoverPiModels(home: string, opts?: {
    /** curated catalog (agent+model pairs) — collisions drop the discovered copy */
    curated?: Array<{
        agent: string;
        model: string;
    }>;
    /** is the pi binary on PATH — false blankets everything with the install fix */
    piInstalled?: boolean;
    env?: Record<string, string | undefined>;
}): DiscoveredModel[];
