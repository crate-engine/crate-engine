// W0 (UX-QC C2): the sign-in button must ACT, not hand back homework. On
// macOS it opens Terminal with the agent's own sign-in command already
// running — the wizard's live detection (W0, C1) then notices the completed
// sign-in by itself. Pure plan + spawn split (the appwindow.ts pattern) so
// tests assert the plan without opening real windows.
import { spawn } from "node:child_process";
/** The launch plan for one agent sign-in command (cmd is one of the fixed
 * crew binaries — pi/claude/codex — never user input). */
export function terminalPlan(cmd, platform = process.platform) {
    if (platform === "darwin") {
        // `do script` opens a NEW Terminal window already running the command.
        // macOS may ask once to allow controlling Terminal — that prompt is
        // Apple's; approving it is the one-time cost of the one-click sign-in.
        return {
            bin: "osascript",
            args: [
                "-e",
                'tell application "Terminal" to activate',
                "-e",
                `tell application "Terminal" to do script "${cmd}"`,
            ],
            mode: "run",
            note: `Terminal is opening with \`${cmd}\` running — finish the sign-in there; this screen notices by itself.`,
        };
    }
    return {
        mode: "none",
        note: `Open a terminal and run \`${cmd}\` to sign in — this screen notices by itself.`,
    };
}
/** Execute the plan (detached; the window outlives the request). */
export function openSignInTerminal(cmd, platform = process.platform) {
    const plan = terminalPlan(cmd, platform);
    if (plan.mode === "run" && plan.bin) {
        try {
            const child = spawn(plan.bin, plan.args ?? [], { detached: true, stdio: "ignore" });
            child.unref();
        }
        catch {
            return {
                mode: "none",
                note: `Could not open Terminal automatically — open it yourself and run \`${cmd}\`; this screen notices by itself.`,
            };
        }
    }
    return { mode: plan.mode, note: plan.note };
}
//# sourceMappingURL=terminal.js.map