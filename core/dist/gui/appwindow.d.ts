/** First existing Chromium binary (absolute path on mac; PATH-resolved on linux). */
export declare function findChromium(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Build the app-mode launch plan for a URL. Returns the Chromium argv when one
 * is found (chromeless `--app=` window, its own profile dir so it's a distinct
 * Dock app), else an OS-opener fallback (`open`/`xdg-open`) — the caller
 * spawns it. Pure + platform-injectable so it is unit-testable.
 */
export declare function appWindowPlan(url: string, opts?: {
    platform?: NodeJS.Platform;
    home?: string;
    env?: NodeJS.ProcessEnv;
}): {
    bin: string;
    args: string[];
    mode: "app" | "browser";
};
/** Open the GUI as an app-mode window (or a browser tab fallback). Detached. */
export declare function openAppWindow(url: string, opts?: {
    platform?: NodeJS.Platform;
    home?: string;
    env?: NodeJS.ProcessEnv;
}): {
    mode: "app" | "browser";
};
/** Can this host show a window at all? linux with no DISPLAY/WAYLAND_DISPLAY
 * (an ssh session, a server) cannot — `crate open` then becomes a headless
 * server boot + a printed operator handoff instead of a dead xdg-open. */
export declare function hasDisplay(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): boolean;
/** The operator handoff printed on a display-less host: the server is UP —
 * here is exactly how to put its window on your laptop. Pure (testable). */
export declare function headlessHandoff(teamUrl: string): string[];
