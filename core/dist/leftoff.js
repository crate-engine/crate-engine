// "Where we left off" (PDR dev/pdr/workspace-controls.md, decision 6 — Adam,
// 2026-09-24: "just a short note would be fine where it left off"). Written
// by the ENGINE at every Stop — mechanical, no agent turn, so Stop never waits
// on a model — from ground truth only: the event log, git, each seat's own
// state file, and unread mail. Resume fresh hands it to the orchestrator
// first; a months-later return reads it instead of a stale conversation.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const SEATS = ["orchestrator", "coder", "reviewer", "designer", "tester"];
export function leftOffPath(projectRoot) {
    return join(projectRoot, ".agents", "state", "checkpoints", "LEFT-OFF.md");
}
function git(projectRoot, args) {
    try {
        return execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    }
    catch {
        return "";
    }
}
/** The seat's own words about NOW: its Now / Next / Blockers sections when it
 * keeps them, else its first few lines. Bounded — a note, not a dump. */
export function seatSummary(text) {
    const lines = text.split("\n");
    const picked = [];
    let take = false;
    for (const l of lines) {
        const h = /^#{1,4}\s*(.+?)\s*$/.exec(l) ?? /^\*\*(.+?)\*\*:?\s*$/.exec(l);
        if (h) {
            take = /^(now|next|blockers?|status|current)\b/i.test(h[1].trim());
            if (take)
                picked.push(`${h[1].trim()}:`);
            continue;
        }
        const inline = /^(?:[-*]\s*)?\**(now|next|blockers?|status)\**\s*[:—-]\s*(.+)$/i.exec(l.trim());
        if (inline) {
            picked.push(`${inline[1]}: ${inline[2]}`);
            continue;
        }
        if (take && l.trim())
            picked.push(`  ${l.trim()}`);
    }
    const out = picked.length ? picked : lines.filter((l) => l.trim() && !l.startsWith("#")).slice(0, 4).map((l) => l.trim());
    return out.slice(0, 10).map((l) => (l.length > 200 ? `${l.slice(0, 197)}…` : l));
}
function localStamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Compose the note (pure over what it reads — exported for tests). */
export function composeLeftOff(projectRoot, now = new Date()) {
    const state = join(projectRoot, ".agents", "state");
    const events = existsSync(join(state, "events.log")) ? readFileSync(join(state, "events.log"), "utf8").split("\n").filter(Boolean) : [];
    const lastState = [...events].reverse().map((l) => / state=(\S+)/.exec(l)?.[1]).find(Boolean) ?? "unknown";
    const lastTask = [...events].reverse().map((l) => /(?:branch|task)=(\S+)/.exec(l)?.[1]).find(Boolean);
    const out = [];
    out.push(`# Where we left off — ${basename(projectRoot)}`);
    out.push("");
    out.push(`Stopped ${localStamp(now)}. Written by the engine at Stop (mechanical — no agent wrote this).`);
    out.push("Resume fresh reads this first; the agents then scout the project to confirm it.");
    out.push("");
    out.push("## Loop");
    out.push(`- State: ${lastState}${lastTask ? ` — last task/branch: ${lastTask}` : ""}`);
    const branch = git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch) {
        out.push("");
        out.push("## Code");
        out.push(`- Checkout: ${branch} @ ${git(projectRoot, ["log", "-1", "--format=%h %s (%cr)"]) || "no commits"}`);
        const dirty = git(projectRoot, ["status", "--porcelain", "--", ".", ":(exclude).agents"]).split("\n").filter(Boolean);
        out.push(`- Uncommitted changes: ${dirty.length ? `${dirty.length} file(s)` : "none"}`);
        for (const d of dirty.slice(0, 8))
            out.push(`  - ${d.trim()}`);
        if (dirty.length > 8)
            out.push(`  - … ${dirty.length - 8} more`);
    }
    out.push("");
    out.push("## Seats");
    for (const seat of SEATS) {
        const f = join(state, `${seat}.md`);
        const unreadDir = join(state, "inbox", seat, "new");
        const unread = existsSync(unreadDir) ? readdirSync(unreadDir).filter((n) => n.endsWith(".msg")).length : 0;
        const mail = unread ? ` · ${unread} unread message(s)` : "";
        if (!existsSync(f)) {
            out.push(`- **${seat}**: no state file${mail}`);
            continue;
        }
        const summary = seatSummary(readFileSync(f, "utf8"));
        out.push(`- **${seat}**${mail}`);
        for (const l of summary)
            out.push(`  ${l}`);
    }
    if (events.length) {
        out.push("");
        out.push("## Last events");
        for (const e of events.slice(-12))
            out.push(`- ${e.length > 180 ? `${e.slice(0, 177)}…` : e}`);
    }
    return out.join("\n") + "\n";
}
/** Write the note (and an archive copy). Best-effort: returns the path, or
 * undefined when the rig has no state dir to write into. */
export function writeLeftOff(projectRoot, now = new Date()) {
    const dir = join(projectRoot, ".agents", "state", "checkpoints");
    if (!existsSync(join(projectRoot, ".agents", "state")))
        return undefined;
    try {
        mkdirSync(join(dir, "archive"), { recursive: true });
        const body = composeLeftOff(projectRoot, now);
        writeFileSync(leftOffPath(projectRoot), body);
        writeFileSync(join(dir, "archive", `left-off-${localStamp(now).replace(/[ :]/g, "-")}.md`), body);
        return leftOffPath(projectRoot);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=leftoff.js.map