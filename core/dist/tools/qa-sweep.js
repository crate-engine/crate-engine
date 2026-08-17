// qa-sweep — P2-1: the QA seat's deterministic evidence bundle in ONE bash call
// (CLI-first, §6.3). Per route × {mobile 390×844, desktop 1280×800}: console
// errors, responses ≥400, horizontal overflow, full-page screenshot. Routes come
// from --routes or the project AGENTS.md "Critical paths" section — NEVER
// hardcoded (the precheck.sh finding).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
/** Console lines the BROWSER emits about itself, not defects in the app.
 *
 * CE-115: headless Chromium logs an error for permissions-policy tokens it
 * doesn't implement (compute-pressure among them), so every mobile sweep of
 * every route carried a phantom console error. A QA seat that learns to ignore
 * "the usual one" will ignore the real one sitting next to it. These are
 * FILTERED, never dropped: the count is printed and the text lands in
 * qa-sweep.json under consoleNoise. `--no-filter` turns the filter off. */
export const CONSOLE_NOISE = [
    {
        pattern: /Unrecognized feature:\s*['"]?compute-pressure/i,
        why: "Chromium doesn't implement the compute-pressure permissions-policy token — the header is valid; the warning is a browser-version artifact",
    },
    {
        pattern: /Error with Permissions-Policy header:\s*Unrecognized feature/i,
        why: "same family: a permissions-policy token this Chromium build doesn't know",
    },
];
export function isConsoleNoise(text) {
    return CONSOLE_NOISE.some((n) => n.pattern.test(text));
}
function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
/** The rig's own dev URL (rig.conf DEV_URL) — the sweep's default base.
 * P7-T3 find: a hardcoded fallback port once swept a DIFFERENT app that
 * happened to be serving there; QA had to discard the evidence. */
export function devUrlFromRigConf(project) {
    const conf = join(project, ".agents", "rig.conf");
    if (!existsSync(conf))
        return undefined;
    const m = readFileSync(conf, "utf8").match(/^\s*DEV_URL="?([^"\n]+)"?\s*$/m);
    return m?.[1]?.trim() || undefined;
}
/** Refuse-to-guess base resolution + a loud liveness probe. Returns the base,
 * or undefined after printing WHY (the caller exits non-zero). */
export async function resolveBase(explicit, project, tool) {
    const base = (explicit ?? devUrlFromRigConf(project))?.replace(/\/+$/, "");
    if (!base) {
        console.log(`${tool}: no --base given and no DEV_URL in ${join(project, ".agents", "rig.conf")} — refusing to guess a port ` +
            `(a guessed base once swept a DIFFERENT app). Pass --base or set rig.conf DEV_URL.`);
        return undefined;
    }
    if (/^https?:/.test(base)) {
        try {
            await fetch(base, { signal: AbortSignal.timeout(5000) });
        }
        catch {
            console.log(`${tool}: nothing is serving at ${base} — start the dev server (.agents/bin/dev-server up) or pass the right --base.`);
            return undefined;
        }
    }
    return base;
}
/** Extract `/route` tokens from the AGENTS.md "Critical paths" section.
 *
 * CE-112: the heading match is CASE- and WORD-tolerant. It used to be
 * `/^##\s+Critical paths/m` with no `/i`, so an AGENTS.md written
 * "## Critical Paths" produced zero routes, the caller silently swept `/`
 * alone, and the report READ as a full pass. Any heading level, any case, and
 * "paths" or "routes" all match now — the sweep must not hinge on a capital P. */
const CRITICAL_HEADING = /^#{1,6}\s+critical\s+(?:paths|routes)\b.*$/im;
export function routesFromAgentsMd(text) {
    const m = CRITICAL_HEADING.exec(text);
    if (!m)
        return [];
    const section = text.slice(m.index + m[0].length).split(/^#{1,6}\s/m)[0] ?? "";
    const found = new Set();
    for (const r of section.matchAll(/`(\/[^\s`]*)`/g))
        found.add(r[1]);
    // CE-130: the prose form `Name (/route)` — the site's own CP1 is written
    // "Homepage (/)", which the backtick-only parse missed, so the sweep skipped
    // Critical Path #1 with no warning. Parens whose first character is `/` are
    // a route; "(see /docs)" and anchor forms "(#crate)" do not match.
    for (const r of section.matchAll(/\((\/[^\s)]*)\)/g))
        found.add(r[1]);
    return [...found];
}
/** The ONE route-resolution path for every sweep tool (qa-sweep, axe-check).
 *
 * CE-112, second half: the old code fell back to `routes = ["/"]` in silence,
 * so "no routes found" and "this app has one route" produced identical output.
 * Coverage that READS as complete but isn't is worse than a loud failure, so
 * the degraded case names itself in the report. */
export function resolveRoutes(explicit, project) {
    const listed = (explicit ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    if (listed.length)
        return { routes: listed, origin: "--routes", degraded: false };
    const agents = join(project, "AGENTS.md");
    if (!existsSync(agents)) {
        return {
            routes: ["/"],
            origin: `DEGRADED: no ${agents} — sweeping "/" only`,
            degraded: true,
        };
    }
    const text = readFileSync(agents, "utf8");
    const routes = routesFromAgentsMd(text);
    if (routes.length)
        return { routes, origin: `AGENTS.md "Critical paths" (${routes.length} routes)`, degraded: false };
    return {
        routes: ["/"],
        origin: CRITICAL_HEADING.test(text)
            ? 'DEGRADED: AGENTS.md has a "Critical paths" heading but no `/route` in backticks under it — sweeping "/" only'
            : 'DEGRADED: AGENTS.md has no "Critical paths" section — sweeping "/" only',
        degraded: true,
    };
}
/** Both playwright cache roots — macOS and Linux (FLAWS "qa-sweep's
 * chromium-cache discovery is macOS-only"). Scanning both everywhere costs
 * one existsSync and never guesses the platform. */
export function defaultCacheRoots(home) {
    return [join(home, "Library", "Caches", "ms-playwright"), join(home, ".cache", "ms-playwright")];
}
/** The ONE canonical executable candidate list, verbatim from real caches
 * (Mac + Superman, 2026-07-12). Headless shell preferred; newest version dir
 * first. KEEP IN SYNC with bin/mobile-check.js and core/tools/qa-chrome —
 * two of the three carried stale Linux paths (chrome-linux/, …-linux/) that
 * missed the real chrome-linux64/ layout. */
const CHROMIUM_CANDIDATES = [
    join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
    join("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    join("chrome-headless-shell-linux64", "chrome-headless-shell"),
    join("chrome-headless-shell-linux", "chrome-headless-shell"), // pre-linux64 layout
    join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join("chrome-linux64", "chrome"),
    join("chrome-linux", "chrome"), // pre-linux64 layout
];
export function chromiumFromCache(roots) {
    for (const cache of roots) {
        if (!existsSync(cache))
            continue;
        for (const dir of readdirSync(cache).sort().reverse()) {
            for (const rel of CHROMIUM_CANDIDATES) {
                const candidate = join(cache, dir, rel);
                if (existsSync(candidate))
                    return candidate;
            }
        }
    }
    return undefined;
}
export function findChromium() {
    try {
        const p = chromium.executablePath();
        if (p && existsSync(p))
            return p;
    }
    catch {
        /* registry miss — fall through to the cache scan */
    }
    const found = chromiumFromCache(defaultCacheRoots(homedir()));
    if (found)
        return found;
    throw new Error("no Playwright browser found — install one with: npx playwright-core install chromium-headless-shell");
}
const VIEWPORTS = [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
];
async function main() {
    // CE-132: --help must be HELP — this used to fall through into a full
    // browser sweep that wrote evidence to /tmp (CE-127's disease, second tool).
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log([
            "usage: qa-sweep [--project <dir>] [--base <url>] [--routes </a,/b>] [--out <dir>] [--no-filter]",
            "  Per route × {mobile 390×844, desktop 1280×800}: console errors, responses ≥400,",
            "  horizontal overflow, full-page screenshot. Routes: --routes, else the project",
            "  AGENTS.md 'Critical paths' section; base: --base, else rig.conf DEV_URL.",
        ].join("\n"));
        return;
    }
    const out = arg("--out") ?? "/tmp/qa-sweep";
    const project = arg("--project") ?? ".";
    const base = await resolveBase(arg("--base"), project, "qa-sweep");
    if (!base) {
        process.exitCode = 2;
        return;
    }
    const src = resolveRoutes(arg("--routes"), project);
    const routes = src.routes;
    const filterNoise = !process.argv.includes("--no-filter");
    console.log(`qa-sweep: routes from ${src.origin}`);
    mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ executablePath: findChromium() });
    const results = [];
    for (const route of routes) {
        for (const vp of VIEWPORTS) {
            const r = {
                route,
                viewport: vp.name,
                consoleErrors: [],
                consoleNoise: [],
                badResponses: [],
                overflow: false,
                screenshot: join(out, `${(route.replace(/[^a-z0-9]+/gi, "_") || "home") + "-" + vp.name}.png`),
            };
            const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
            page.on("console", (m) => {
                if (m.type() !== "error")
                    return;
                const text = m.text();
                if (filterNoise && isConsoleNoise(text))
                    r.consoleNoise.push(text);
                else
                    r.consoleErrors.push(text);
            });
            page.on("response", (res) => res.status() >= 400 && r.badResponses.push(`${res.status()} ${res.url()}`));
            try {
                await page.goto(base + route, { waitUntil: "networkidle", timeout: 20000 });
                r.overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
                await page.screenshot({ path: r.screenshot, fullPage: true });
            }
            catch (e) {
                r.error = e instanceof Error ? e.message : String(e);
            }
            await page.close();
            results.push(r);
        }
    }
    await browser.close();
    writeFileSync(join(out, "qa-sweep.json"), JSON.stringify({ base, routes, routeOrigin: src.origin, degraded: src.degraded, filterNoise, results }, null, 2));
    let issues = 0;
    let noise = 0;
    for (const r of results) {
        const bad = (r.error ? 1 : 0) + r.consoleErrors.length + r.badResponses.length + (r.overflow ? 1 : 0);
        issues += bad;
        noise += r.consoleNoise.length;
        console.log(`${r.route} [${r.viewport}] ${bad === 0 ? "OK" : "ISSUES"}${r.error ? ` load-error: ${r.error}` : ""}${r.consoleErrors.length ? ` console-errors: ${r.consoleErrors.length}` : ""}${r.badResponses.length ? ` bad-responses: ${r.badResponses.length}` : ""}${r.overflow ? " HORIZONTAL-OVERFLOW" : ""}${r.consoleNoise.length ? ` (+${r.consoleNoise.length} browser-noise, filtered)` : ""}`);
    }
    console.log(`SUMMARY: ${results.length} checks over ${routes.length} route(s), ${issues} issue(s)` +
        `${noise ? `, ${noise} browser-noise line(s) filtered (see consoleNoise in qa-sweep.json; --no-filter to keep them)` : ""}` +
        `. Evidence: ${out} (qa-sweep.json + screenshots)`);
    if (src.degraded) {
        console.log(`qa-sweep: COVERAGE WARNING — ${src.origin}. This is NOT a full sweep; do not report it as one.`);
    }
}
if (process.argv[1]?.endsWith("qa-sweep.js") || process.argv[1]?.endsWith("qa-sweep.ts")) {
    await main();
}
//# sourceMappingURL=qa-sweep.js.map