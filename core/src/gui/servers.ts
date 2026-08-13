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

export interface ServerRow {
  port: number;
  pid: number;
  label: string;
  /** seat that registered it, or "discovered" */
  from: string;
  /** the loop (branch) it belongs to; "" when unknown */
  task: string;
  kind: "registered" | "discovered" | "system-service";
  status: "live" | "orphaned";
  orphanedAt: string | null;
  /** last preview registration touch (the registry upserts per registration) */
  registeredAt: string | null;
  killable: boolean;
  rssMb: number | null;
  ageSecs: number | null;
}

export interface KillResult {
  ok: boolean;
  freed: boolean;
  escalated: boolean;
  port: number;
  pid: number;
  note: string;
}

/** Registry record shape written by `agentctl preview` (python side). */
interface Registration {
  url: string;
  port: number;
  label: string;
  from: string;
  task: string;
  at: string;
  status: "live" | "orphaned";
  orphanedAt?: string;
}

export type Exec = (cmd: string, args: string[]) => string;

const sh: Exec = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

export function hasLsof(): boolean {
  return spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;
}

interface Listener {
  pid: number;
  port: number;
}

/** Every TCP listener on the machine, as (pid, port) pairs — read-only. */
export function listListeners(exec: Exec = sh): Listener[] {
  const out = exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
  const seen = new Set<string>();
  const rows: Listener[] = [];
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
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
function belongsTo(pid: number, projPaths: string[], exec: Exec): boolean {
  const cmd = exec("ps", ["-o", "command=", "-p", String(pid)]);
  if (projPaths.some((p) => cmd.includes(p))) return true;
  return exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .split("\n")
    .some((l) => l.startsWith("n") && projPaths.some((p) => l.slice(1) === p || l.slice(1).startsWith(p + "/")));
}

function procInfo(pid: number, exec: Exec): { pgid: number | null; rssMb: number | null; ageSecs: number | null } {
  const out = exec("ps", ["-o", "pgid=,rss=,etime=", "-p", String(pid)]).trim();
  if (!out) return { pgid: null, rssMb: null, ageSecs: null };
  const [pgid, rss, etime] = out.split(/\s+/);
  return {
    pgid: Number(pgid) || null,
    rssMb: rss ? Math.round(Number(rss) / 1024) : null,
    ageSecs: parseEtime(etime ?? ""),
  };
}

/** ps etime is [[dd-]hh:]mm:ss. */
export function parseEtime(s: string): number | null {
  const m = s.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** Standing-infra ports from rig.conf — shown, tagged, never killable. */
function systemPorts(proj: string): Set<number> {
  const ports = new Set<number>();
  try {
    const conf = parseRigConf(readFileSync(join(proj, ".agents", "rig.conf"), "utf8"));
    for (const p of [conf.DEV_PORT, conf.PREVIEW_DEV_PORT]) {
      if (p && Number(p)) ports.add(Number(p));
    }
    if (conf.DEV_URL) {
      const p = Number(new URL(conf.DEV_URL).port);
      if (p) ports.add(p);
    }
  } catch {
    /* no rig.conf / unparsable URL — nothing is tagged, nothing breaks */
  }
  return ports;
}

const registryPath = (proj: string): string => join(proj, ".agents", "state", "servers.json");

function readRegistry(proj: string): Registration[] {
  const f = registryPath(proj);
  if (!existsSync(f)) return [];
  try {
    const items = JSON.parse(readFileSync(f, "utf8")) as Registration[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export interface ServersView {
  servers: ServerRow[];
  /** killable orphans only — the chip count; an unkillable "orphan" is a
   * system service and never needs the operator's attention */
  orphans: number;
  lsofAvailable: boolean;
}

export function serversView(proj: string, exec: Exec = sh): ServersView {
  const lsofAvailable = hasLsof();
  const listeners = lsofAvailable ? listListeners(exec) : [];
  const sys = systemPorts(proj);
  const reg = readRegistry(proj);
  const rows: ServerRow[] = [];
  const claimed = new Set<number>();

  // Registered rows first (the proven association). A row whose port has no
  // listener is a server that already died — it needs no row and no kill, so
  // the read prunes it (a swept orphan cleans itself off the panel this way).
  const surviving: Registration[] = [];
  for (const r of reg) {
    const l = listeners.find((x) => x.port === r.port);
    if (!l) continue;
    surviving.push(r);
    if (claimed.has(r.port)) continue;
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
    if (real !== proj) projPaths = [proj, real];
  } catch {
    /* project gone mid-read — the raw path still matches nothing, fine */
  }
  for (const l of listeners) {
    if (claimed.has(l.port)) continue;
    const system = sys.has(l.port);
    if (!system && !belongsTo(l.pid, projPaths, exec)) continue;
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

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer().once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The confirmed-kill doctrine (precheck Rider 1): SIGTERM the GROUP, PROVE
 * the port freed by binding it, escalate to SIGKILL once, stamp honestly.
 * Refuses stale rows (the pid must still hold the port RIGHT NOW — pid reuse
 * between panel paint and click must not kill an innocent). */
export async function confirmedKill(port: number, pid: number, exec: Exec = sh): Promise<KillResult> {
  if (!listListeners(exec).some((l) => l.port === port && l.pid === pid)) {
    return { ok: false, freed: false, escalated: false, port, pid, note: "stale row — that pid no longer holds the port (panel refreshes)" };
  }
  const { pgid } = procInfo(pid, exec);
  const term = (sig: NodeJS.Signals): void => {
    try {
      process.kill(pgid ? -pgid : pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
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

/** One click, still the operator's: kill every killable orphan, sequentially,
 * each through the same confirmed-kill. Freed ports prune on the next read. */
export async function sweepOrphans(proj: string, exec: Exec = sh): Promise<KillResult[]> {
  const results: KillResult[] = [];
  for (const s of serversView(proj, exec).servers) {
    if (s.status !== "orphaned" || !s.killable) continue;
    results.push(await confirmedKill(s.port, s.pid, exec));
  }
  return results;
}
