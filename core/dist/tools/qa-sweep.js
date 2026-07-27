// qa-sweep — P2-1: the QA seat's deterministic evidence bundle in ONE bash call
// (CLI-first, §6.3). Per route × {mobile 390×844, desktop 1280×800}: console
// errors, responses ≥400, horizontal overflow, full-page screenshot. Routes come
// from --routes or the project AGENTS.md "Critical paths" section — NEVER
// hardcoded (the precheck.sh finding).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
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
/** Extract `/route` tokens from the AGENTS.md "Critical paths" section. */
export function routesFromAgentsMd(text) {
    const section = text.split(/^##\s+Critical paths.*$/m)[1]?.split(/^##\s/m)[0] ?? "";
    const found = new Set();
    for (const m of section.matchAll(/`(\/[^\s`]*)`/g))
        found.add(m[1]);
    return [...found];
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
    const out = arg("--out") ?? "/tmp/qa-sweep";
    const project = arg("--project") ?? ".";
    const base = await resolveBase(arg("--base"), project, "qa-sweep");
    if (!base) {
        process.exitCode = 2;
        return;
    }
    let routes = (arg("--routes") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    if (routes.length === 0) {
        const agents = join(project, "AGENTS.md");
        if (existsSync(agents))
            routes = routesFromAgentsMd(readFileSync(agents, "utf8"));
        if (routes.length === 0)
            routes = ["/"];
    }
    mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ executablePath: findChromium() });
    const results = [];
    for (const route of routes) {
        for (const vp of VIEWPORTS) {
            const r = {
                route,
                viewport: vp.name,
                consoleErrors: [],
                badResponses: [],
                overflow: false,
                screenshot: join(out, `${(route.replace(/[^a-z0-9]+/gi, "_") || "home") + "-" + vp.name}.png`),
            };
            const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
            page.on("console", (m) => m.type() === "error" && r.consoleErrors.push(m.text()));
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
    writeFileSync(join(out, "qa-sweep.json"), JSON.stringify({ base, routes, results }, null, 2));
    let issues = 0;
    for (const r of results) {
        const bad = (r.error ? 1 : 0) + r.consoleErrors.length + r.badResponses.length + (r.overflow ? 1 : 0);
        issues += bad;
        console.log(`${r.route} [${r.viewport}] ${bad === 0 ? "OK" : "ISSUES"}${r.error ? ` load-error: ${r.error}` : ""}${r.consoleErrors.length ? ` console-errors: ${r.consoleErrors.length}` : ""}${r.badResponses.length ? ` bad-responses: ${r.badResponses.length}` : ""}${r.overflow ? " HORIZONTAL-OVERFLOW" : ""}`);
    }
    console.log(`SUMMARY: ${results.length} checks, ${issues} issue(s). Evidence: ${out} (qa-sweep.json + screenshots)`);
}
if (process.argv[1]?.endsWith("qa-sweep.js") || process.argv[1]?.endsWith("qa-sweep.ts")) {
    await main();
}
//# sourceMappingURL=qa-sweep.js.map