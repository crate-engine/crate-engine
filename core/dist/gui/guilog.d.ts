export declare function guiLogPath(home: string): string;
/** Open the log for a spawned child's stdout/stderr (the `crate open` side). */
export declare function openGuiLogFd(home: string): number;
export declare function guiLog(home: string, line: string): void;
/**
 * Death forensics for the server process: fatal errors and signals land in
 * gui.log, and `cleanup` (kill the runner children) runs before exit — a
 * crashed supervisor must not leave orphans (the ppid watchdog in runnerLoop
 * is the backstop for the un-catchable SIGKILL case).
 */
export declare function installGuiCrashLog(home: string, cleanup?: () => void): void;
