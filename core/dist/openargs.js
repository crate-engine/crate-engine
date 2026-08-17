// openargs — the loud argument parser for `crate open` (CE-127).
//
// `open` used to read only `--project <path>` and silently DROP everything
// else. A bare positional path — the exact form the DETACHED banner and the
// P1 guard's own cancel message prescribe — fell through to the cwd project,
// so the guard compared the WRONG target and the operator believed they had
// switched workspaces when they had not (battle test, 2026-08-17). `--help`
// executed instead of printing usage. The rule this module enforces: `open`
// never reinterprets its target in silence — a positional IS the project, an
// unknown flag is an error, help is help.
export const OPEN_USAGE = [
    "usage: crate open [<project-path>] [--stop-others] [--print-url]",
    "       crate open --project <path>            (same as the positional)",
    "       crate open --remote <ssh-host> [--print-url]",
].join("\n");
const VALUED = new Set(["--remote", "--project"]);
const KNOWN = new Set(["--remote", "--project", "--print-url", "--stop-others", "--force", "--cmux", "--help", "-h"]);
export function parseOpenArgs(rest) {
    if (rest.includes("--help") || rest.includes("-h"))
        return { kind: "help" };
    const positionals = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith("-")) {
            if (!KNOWN.has(a))
                return { kind: "error", message: `unknown option ${a}` };
            if (VALUED.has(a))
                i++; // its value is not a positional
            continue;
        }
        positionals.push(a);
    }
    if (positionals.length > 1)
        return { kind: "error", message: `one project path only (got: ${positionals.join(", ")})` };
    const positional = positionals[0];
    const printUrl = rest.includes("--print-url");
    const rIdx = rest.indexOf("--remote");
    if (rIdx !== -1) {
        const host = rest[rIdx + 1];
        if (!host || host.startsWith("-"))
            return { kind: "error", message: "--remote <ssh-host> — the ssh host is missing" };
        if (positional)
            return {
                kind: "error",
                message: `a project path with --remote is not supported — the remote host's own \`crate open\` picks its project (got: ${positional})`,
            };
        return { kind: "remote", host, printUrl };
    }
    const pIdx = rest.indexOf("--project");
    const flagProject = pIdx !== -1 ? rest[pIdx + 1] : undefined;
    if (pIdx !== -1 && (!flagProject || flagProject.startsWith("-")))
        return { kind: "error", message: "--project needs a path" };
    if (flagProject && positional && flagProject !== positional)
        return { kind: "error", message: `two different projects given — ${positional} (positional) vs ${flagProject} (--project)` };
    return {
        kind: "local",
        project: flagProject ?? positional,
        printUrl,
        stopOthers: rest.includes("--stop-others") || rest.includes("--force"),
    };
}
//# sourceMappingURL=openargs.js.map