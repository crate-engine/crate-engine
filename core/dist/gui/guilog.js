// PHASE-B #1 — the GUI server's black box. The server runs detached with its
// stdio previously DISCARDED (`crate open` spawned it stdio:"ignore"), and it
// had no process-level crash handlers — so when it died mid-run (testuser8,
// 2026-07-13) there was nothing to diagnose: no log existed, the cockpit froze
// on stale state, the runners kept working for a dead supervisor. Every line
// here is timestamped into ~/.crate/logs/gui.log; the crash handlers write the
// reason BEFORE the process dies (Node ≥15 exits on unhandled rejections).
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { tierPaths } from "../usertier.js";
import { localIsoOffset } from "../mailbox.js";
export function guiLogPath(home) {
    return join(tierPaths(home).root, "logs", "gui.log");
}
/** Open the log for a spawned child's stdout/stderr (the `crate open` side). */
export function openGuiLogFd(home) {
    const p = guiLogPath(home);
    mkdirSync(dirname(p), { recursive: true });
    return openSync(p, "a");
}
export function guiLog(home, line) {
    try {
        const p = guiLogPath(home);
        mkdirSync(dirname(p), { recursive: true });
        appendFileSync(p, `[${localIsoOffset()}] ${line}\n`);
    }
    catch {
        /* logging must never take the server down */
    }
}
/**
 * Death forensics for the server process: fatal errors and signals land in
 * gui.log, and `cleanup` (kill the runner children) runs before exit — a
 * crashed supervisor must not leave orphans (the ppid watchdog in runnerLoop
 * is the backstop for the un-catchable SIGKILL case).
 */
export function installGuiCrashLog(home, cleanup) {
    const die = (kind, detail, code) => {
        guiLog(home, `FATAL ${kind}: ${detail}`);
        try {
            cleanup?.();
        }
        catch {
            /* best-effort — the watchdog reaps what this misses */
        }
        process.exit(code);
    };
    process.on("uncaughtException", (e) => die("uncaughtException", e instanceof Error ? (e.stack ?? e.message) : String(e), 1));
    process.on("unhandledRejection", (e) => die("unhandledRejection", e instanceof Error ? (e.stack ?? e.message) : String(e), 1));
    process.on("SIGTERM", () => die("SIGTERM", "terminated", 0));
    process.on("SIGINT", () => die("SIGINT", "interrupted", 0));
}
//# sourceMappingURL=guilog.js.map