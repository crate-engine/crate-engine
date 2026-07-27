/** The rig's own dev URL (rig.conf DEV_URL) — the sweep's default base.
 * P7-T3 find: a hardcoded fallback port once swept a DIFFERENT app that
 * happened to be serving there; QA had to discard the evidence. */
export declare function devUrlFromRigConf(project: string): string | undefined;
/** Refuse-to-guess base resolution + a loud liveness probe. Returns the base,
 * or undefined after printing WHY (the caller exits non-zero). */
export declare function resolveBase(explicit: string | undefined, project: string, tool: string): Promise<string | undefined>;
/** Extract `/route` tokens from the AGENTS.md "Critical paths" section. */
export declare function routesFromAgentsMd(text: string): string[];
/** Both playwright cache roots — macOS and Linux (FLAWS "qa-sweep's
 * chromium-cache discovery is macOS-only"). Scanning both everywhere costs
 * one existsSync and never guesses the platform. */
export declare function defaultCacheRoots(home: string): string[];
export declare function chromiumFromCache(roots: string[]): string | undefined;
export declare function findChromium(): string;
