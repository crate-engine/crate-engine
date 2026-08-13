// Backlog 13 (grilled with Adam, 2026-08-13): the Servers panel — visible
// dev-server lifecycle. Root cause of leaked servers is OBSERVABILITY, so the
// build is a window, not a reaper:
//   - Adoption handle = REGISTERED PREVIEWS (agentctl preview writes
//     state/servers.json — a registry that SURVIVES close; close re-TAGS the
//     loop's rows "orphaned", it never kills), union'd with READ-ONLY
//     discovery: a listener whose process demonstrably lives in this project
//     (the dev-server kill_adhoc technique — command names the project, or
//     the process cwd is inside it).
//   - NOTHING DIES WITHOUT THE OPERATOR'S CLICK (Adam's house law — same
//     principle as the merge gate). The one automation moves a LABEL.
//   - Standing infra (the rig.conf DEV_URL/DEV_PORT service) is visible but
//     untouchable: kind "system-service", killable=false.
//   - Kills run the confirmed-kill doctrine (precheck Rider 1, ported):
//     SIGTERM the GROUP → PROVE the port freed by binding it → one SIGKILL
//     escalation → stamp honestly. "Sent" is never reported as "dead".
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseRigConf } from "../staffing.js";
const sh = (cmd, args) => {
    try {
        return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    }
    catch {
        return "";
    }
};
export function hasLsof() {
    return spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;
}
/** Every TCP listener on the machine, as (pid, port) pairs — read-only. */
export function listListeners(exec = sh) {
    const out = exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
    const seen = new Set();
    const rows = [];
    let pid = 0;
    for (const line of out.split("\n")) {
        if (line.startsWith("p"))
            pid = Number(line.slice(1));
        else if (line.startsWith("n")) {
            const m = line.match(/:(\d+)$/);
            if (m && pid && !seen.has(`${pid}:${m[1]}`)) {
                seen.add(`${pid}:${m[1]}`);
                rows.push({ pid, port: Number(m[1]) });
            }
        }
    }
    return rows;
}
/** "Born inside the rig's session": the command names the project path, or
 * the process cwd is inside it (the bin/dev-server kill_adhoc technique).
 * Matched against BOTH the given path and its realpath — lsof reports
 * resolved paths (macOS /var → /private/var), symlinked rigs are real. */
function belongsTo(pid, projPaths, exec) {
    const cmd = exec("ps", ["-o", "command=", "-p", String(pid)]);
    if (projPaths.some((p) => cmd.includes(p)))
        return true;
    return exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
        .split("\n")
        .some((l) => l.startsWith("n") && projPaths.some((p) => l.slice(1) === p || l.slice(1).startsWith(p + "/")));
}
function procInfo(pid, exec) {
    const out = exec("ps", ["-o", "pgid=,rss=,etime=", "-p", String(pid)]).trim();
    if (!out)
        return { pgid: null, rssMb: null, ageSecs: null };
    const [pgid, rss, etime] = out.split(/\s+/);
    return {
        pgid: Number(pgid) || null,
        rssMb: rss ? Math.round(Number(rss) / 1024) : null,
        ageSecs: parseEtime(etime ?? ""),
    };
}
/** ps etime is [[dd-]hh:]mm:ss. */
export function parseEtime(s) {
    const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
    if (!m)
        return null;
    return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}
/** Standing-infra ports from rig.conf — shown, tagged, never killable. */
function systemPorts(proj) {
    const ports = new Set();
    try {
        const conf = parseRigConf(readFileSync(join(proj, ".agents", "rig.conf"), "utf8"));
        for (const p of [conf.DEV_PORT, conf.PREVIEW_DEV_PORT]) {
            if (p && Number(p))
                ports.add(Number(p));
        }
        if (conf.DEV_URL) {
            const p = Number(new URL(conf.DEV_URL).port);
            if (p)
                ports.add(p);
        }
    }
    catch {
        /* no rig.conf / unparsable URL — nothing is tagged, nothing breaks */
    }
    return ports;
}
const registryPath = (proj) => join(proj, ".agents", "state", "servers.json");
function readRegistry(proj) {
    const f = registryPath(proj);
    if (!existsSync(f))
        return [];
    try {
        const items = JSON.parse(readFileSync(f, "utf8"));
        return Array.isArray(items) ? items : [];
    }
    catch {
        return [];
    }
}
export function serversView(proj, exec = sh) {
    const lsofAvailable = hasLsof();
    const listeners = lsofAvailable ? listListeners(exec) : [];
    const sys = systemPorts(proj);
    const reg = readRegistry(proj);
    const rows = [];
    const claimed = new Set();
    // Registered rows first (the proven association). A row whose port has no
    // listener is a server that already died — it needs no row and no kill, so
    // the read prunes it (a swept orphan cleans itself off the panel this way).
    const surviving = [];
    for (const r of reg) {
        const l = listeners.find((x) => x.port === r.port);
        if (!l)
            continue;
        surviving.push(r);
        if (claimed.has(r.port))
            continue;
        claimed.add(r.port);
        const info = procInfo(l.pid, exec);
        const system = sys.has(r.port);
        rows.push({
            port: r.port,
            pid: l.pid,
            label: r.label || `port ${r.port}`,
            from: r.from || "?",
            task: r.task || "",
            kind: system ? "system-service" : "registered",
            status: r.status === "orphaned" ? "orphaned" : "live",
            orphanedAt: r.orphanedAt ?? null,
            registeredAt: r.at ?? null,
            killable: !system,
            rssMb: info.rssMb,
            ageSecs: info.ageSecs,
        });
    }
    if (surviving.length !== reg.length && existsSync(registryPath(proj))) {
        writeFileSync(registryPath(proj), JSON.stringify(surviving));
    }
    // Read-only discovery: unclaimed listeners that provably belong to this
    // project — plus the standing service port even when its process runs
    // elsewhere (a systemd unit's cwd IS the project, but stay generous).
    let projPaths = [proj];
    try {
        const real = realpathSync(proj);
        if (real !== proj)
            projPaths = [proj, real];
    }
    catch {
        /* project gone mid-read — the raw path still matches nothing, fine */
    }
    for (const l of listeners) {
        if (claimed.has(l.port))
            continue;
        const system = sys.has(l.port);
        if (!system && !belongsTo(l.pid, projPaths, exec))
            continue;
        claimed.add(l.port);
        const info = procInfo(l.pid, exec);
        rows.push({
            port: l.port,
            pid: l.pid,
            label: system ? `port ${l.port} (rig.conf dev server)` : `port ${l.port}`,
            from: "discovered",
            task: "",
            kind: system ? "system-service" : "discovered",
            status: "live",
            orphanedAt: null,
            registeredAt: null,
            killable: !system,
            rssMb: info.rssMb,
            ageSecs: info.ageSecs,
        });
    }
    rows.sort((a, b) => a.port - b.port);
    return { servers: rows, orphans: rows.filter((r) => r.status === "orphaned" && r.killable).length, lsofAvailable };
}
function portFree(port) {
    return new Promise((resolve) => {
        const s = createServer().once("error", () => resolve(false));
        s.listen(port, () => s.close(() => resolve(true)));
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The confirmed-kill doctrine (precheck Rider 1): SIGTERM the GROUP, PROVE
 * the port freed by binding it, escalate to SIGKILL once, stamp honestly.
 * Refuses stale rows (the pid must still hold the port RIGHT NOW — pid reuse
 * between panel paint and click must not kill an innocent). */
export async function confirmedKill(port, pid, exec = sh) {
    if (!listListeners(exec).some((l) => l.port === port && l.pid === pid)) {
        return { ok: false, freed: false, escalated: false, port, pid, note: "stale row — that pid no longer holds the port (panel refreshes)" };
    }
    const { pgid } = procInfo(pid, exec);
    const term = (sig) => {
        try {
            process.kill(pgid ? -pgid : pid, sig);
        }
        catch {
            try {
                process.kill(pid, sig);
            }
            catch {
                /* already gone — the bind probe below is the truth */
            }
        }
    };
    term("SIGTERM");
    let freed = false;
    for (let waited = 0; waited <= 10_000; waited += 250) {
        if (await portFree(port)) {
            freed = true;
            break;
        }
        await sleep(250);
    }
    let escalated = false;
    if (!freed) {
        escalated = true;
        term("SIGKILL");
        await sleep(1000);
        freed = await portFree(port);
    }
    return {
        ok: freed,
        freed,
        escalated,
        port,
        pid,
        note: freed
            ? escalated
                ? "freed after SIGKILL escalation"
                : "freed — SIGTERM landed"
            : "port NOT freed — the group survived SIGKILL (investigate by hand)",
    };
}
/** Engine assist (FLAWS design-previews entry, thread 2 — the belt behind
 * the Pack-2 binder law): a walled seat that binds a listener mid-task and
 * never registers it earns ONE dedup'd nudge to the orchestrator. The law
 * stays a binder law; this only reminds. Conditions: a discovered
 * (unregistered, non-system, project-owned) row; a loop in flight
 * (events.log non-idle); the listener ≥graceSecs old (a seat about to
 * register gets its grace). Dedup marker: state/preview-nag.json, keyed
 * task:port — one nudge per loop per port, ever. Fail-open everywhere. */
export function nagUnregistered(proj, view, graceSecs = 120) {
    const nagged = [];
    try {
        const stateDir = join(proj, ".agents", "state");
        let log = "";
        try {
            log = readFileSync(join(stateDir, "events.log"), "utf8");
        }
        catch {
            return nagged;
        }
        // the /api/loop derivation: task= lines drive per-task states, bare lines
        // the session scalar; any non-idle state = a loop in flight
        let scalar = "down";
        const tasks = {};
        for (const l of log.split("\n")) {
            const st = l.match(/ state=(\S+)/)?.[1];
            if (!st)
                continue;
            const task = l.match(/ task=(\S+)/)?.[1];
            if (task)
                tasks[task] = st;
            else
                scalar = st;
        }
        const IDLE = new Set(["down", "idle", "checkpointed", "initialized"]);
        const liveTasks = Object.keys(tasks).filter((t) => !IDLE.has(tasks[t]));
        if (!liveTasks.length && IDLE.has(scalar))
            return nagged;
        const loopKey = liveTasks.sort().join(",") || scalar;
        const markerPath = join(stateDir, "preview-nag.json");
        let marker = {};
        try {
            marker = JSON.parse(readFileSync(markerPath, "utf8"));
        }
        catch {
            marker = {};
        }
        for (const row of view.servers) {
            if (row.kind !== "discovered")
                continue;
            if (row.ageSecs === null || row.ageSecs < graceSecs)
                continue;
            const key = `${loopKey}:${row.port}`;
            if (marker[key])
                continue;
            const mins = Math.max(1, Math.round(row.ageSecs / 60));
            const msg = `ENGINE ASSIST: a dev server on :${row.port} (pid ${row.pid}) has been live ~${mins}m this loop ` +
                `but is NOT registered with the cockpit. If it is meant for the operator's eyes, have the owning ` +
                `seat run: python3 .agents/bin/agentctl.py preview http://127.0.0.1:${row.port} --from <seat> — ` +
                `registered previews ride the proxy and always reach the operator; loose URLs are fallback only.`;
            try {
                execFileSync("python3", [join(proj, ".agents", "bin", "agentctl.py"), "deliver", "orchestrator", "--from", "engine", msg], {
                    cwd: proj,
                    stdio: "ignore",
                });
                marker[key] = new Date().toISOString();
                nagged.push(row.port);
            }
            catch {
                /* no agentctl / delivery failed — try again next poll, never wedge */
            }
        }
        if (nagged.length)
            writeFileSync(markerPath, JSON.stringify(marker));
    }
    catch {
        /* the assist must never break the panel */
    }
    return nagged;
}
/** One click, still the operator's: kill every killable orphan, sequentially,
 * each through the same confirmed-kill. Freed ports prune on the next read. */
export async function sweepOrphans(proj, exec = sh) {
    const results = [];
    for (const s of serversView(proj, exec).servers) {
        if (s.status !== "orphaned" || !s.killable)
            continue;
        results.push(await confirmedKill(s.port, s.pid, exec));
    }
    return results;
}
//# sourceMappingURL=servers.js.map