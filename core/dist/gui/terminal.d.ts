export interface TerminalPlan {
    bin?: string;
    args?: string[];
    /** "run" = we open Terminal running the command; "none" = tell the user plainly. */
    mode: "run" | "none";
    note: string;
}
/** The launch plan for one agent sign-in command (cmd is one of the fixed
 * crew binaries — pi/claude/codex — never user input). */
export declare function terminalPlan(cmd: string, platform?: NodeJS.Platform): TerminalPlan;
/** Execute the plan (detached; the window outlives the request). */
export declare function openSignInTerminal(cmd: string, platform?: NodeJS.Platform): {
    mode: "run" | "none";
    note: string;
};
