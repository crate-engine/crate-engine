// PHASE-8 T7-3 — the app-mode window: the 2.1 delivery vehicle (design 6b).
// The localhost GUI opens as a CHROMELESS Chromium app-mode window (--app=),
// its own Dock/taskbar icon = the ⚡ bolt, Alt-Tab like a native app — NOT a
// browser tab. Zero new deps (uses an installed Chromium-family browser);
// Tauri is the 2.1.x fast-follow. Falls back to the OS default browser when no
// Chromium is found, so `crate open` never dead-ends.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
/** Chromium-family app-mode candidates, per platform, best first. */
function chromiumCandidates(platform) {
    if (platform === "darwin") {
        return [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
    }
    // linux: resolve by name on PATH (handled by the caller's env scan)
    return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge"];
}
/** First existing Chromium binary (absolute path on mac; PATH-resolved on linux). */
export function findChromium(platform = process.platform, env = process.env) {
    const cands = chromiumCandidates(platform);
    if (platform === "darwin")
        return cands.find((p) => existsSync(p));
    const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
    for (const name of cands) {
        for (const dir of dirs) {
            const p = join(dir, name);
            if (existsSync(p))
                return p;
        }
    }
    return undefined;
}
/**
 * Build the app-mode launch plan for a URL. Returns the Chromium argv when one
 * is found (chromeless `--app=` window, its own profile dir so it's a distinct
 * Dock app), else an OS-opener fallback (`open`/`xdg-open`) — the caller
 * spawns it. Pure + platform-injectable so it is unit-testable.
 */
export function appWindowPlan(url, opts = {}) {
    const platform = opts.platform ?? process.platform;
    const chromium = findChromium(platform, opts.env ?? process.env);
    if (chromium) {
        const profile = join(opts.home ?? process.env.HOME ?? "", ".crate", "app-window");
        return {
            bin: chromium,
            // --app makes it chromeless; a dedicated user-data-dir gives it its own
            // Dock/taskbar entry (the ⚡ app) instead of merging into the user's Chrome.
            args: [`--app=${url}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check"],
            mode: "app",
        };
    }
    // Fallback: the OS default browser (a plain tab — honest degrade, still opens).
    if (platform === "darwin")
        return { bin: "open", args: [url], mode: "browser" };
    return { bin: "xdg-open", args: [url], mode: "browser" };
}
/** Open the GUI as an app-mode window (or a browser tab fallback). Detached. */
export function openAppWindow(url, opts = {}) {
    const plan = appWindowPlan(url, opts);
    const child = spawn(plan.bin, plan.args, { detached: true, stdio: "ignore" });
    child.unref(); // the window outlives `crate open`
    return { mode: plan.mode };
}
//# sourceMappingURL=appwindow.js.map