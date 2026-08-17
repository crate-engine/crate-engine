/** Console lines the BROWSER emits about itself, not defects in the app.
 *
 * CE-115: headless Chromium logs an error for permissions-policy tokens it
 * doesn't implement (compute-pressure among them), so every mobile sweep of
 * every route carried a phantom console error. A QA seat that learns to ignore
 * "the usual one" will ignore the real one sitting next to it. These are
 * FILTERED, never dropped: the count is printed and the text lands in
 * qa-sweep.json under consoleNoise. `--no-filter` turns the filter off. */
export declare const CONSOLE_NOISE: {
    pattern: RegExp;
    why: string;
}[];
export declare function isConsoleNoise(text: string): boolean;
/** The rig's own dev URL (rig.conf DEV_URL) — the sweep's default base.
 * P7-T3 find: a hardcoded fallback port once swept a DIFFERENT app that
 * happened to be serving there; QA had to discard the evidence. */
export declare function devUrlFromRigConf(project: string): string | undefined;
/** Refuse-to-guess base resolution + a loud liveness probe. Returns the base,
 * or undefined after printing WHY (the caller exits non-zero). */
export declare function resolveBase(explicit: string | undefined, project: string, tool: string): Promise<string | undefined>;
export declare function routesFromAgentsMd(text: string): string[];
/** Where the swept routes came from — so the caller can SAY so. */
export interface RouteSource {
    routes: string[];
    /** Human-readable provenance, printed on every run. */
    origin: string;
    /** True when we fell back to `/` alone: coverage is one route, not a sweep. */
    degraded: boolean;
}
/** The ONE route-resolution path for every sweep tool (qa-sweep, axe-check).
 *
 * CE-112, second half: the old code fell back to `routes = ["/"]` in silence,
 * so "no routes found" and "this app has one route" produced identical output.
 * Coverage that READS as complete but isn't is worse than a loud failure, so
 * the degraded case names itself in the report. */
export declare function resolveRoutes(explicit: string | undefined, project: string): RouteSource;
/** Both playwright cache roots — macOS and Linux (FLAWS "qa-sweep's
 * chromium-cache discovery is macOS-only"). Scanning both everywhere costs
 * one existsSync and never guesses the platform. */
export declare function defaultCacheRoots(home: string): string[];
export declare function chromiumFromCache(roots: string[]): string | undefined;
export declare function findChromium(): string;
