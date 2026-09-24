// "Stopped means zero" (PDR dev/pdr/workspace-controls.md, S1 — Adam,
// 2026-09-24: "if it's stopped or archived, there's nothing running in the
// background constantly"). Every seat process carries CRATE_PROJECT=<root>
// (runner.ts seatEnv — both doors), and every child it starts inherits it:
// tools, MCP servers, a bare dev server, a detached browser daemon. That tag
// is how the engine proves a stopped workspace owns nothing:
//   - teardownWorkspace: after the team stops, bring its dev server down and
//     terminate every process still tagged to it, then COUNT what is left.
//   - sweepStopped: close anything tagged to a workspace this engine has on
//     record as NOT running (catches leaks nobody imagined — the CE-188 class).
// Safety: only processes carrying the tag are ever touched (an operator's own
// terminal in the project has no tag); the sweep only claims projects in THIS
// engine's workspace record (a test engine's scratch rigs are invisible to the
// real one and vice versa); the caller's own process and its ancestors are
// never signalled (an engine nested inside a seat inherits the tag).
// Platform limit (honest): macOS will not reveal the environment of its OWN
// platform binaries (sh, bash, zsh, sleep …) even to the same user, so on a Mac a
// bare shell wrapper is invisible to the scan — the real work it runs (node,
// claude, pi, chrome, a dev server) is not. Linux reads /proc/<pid>/environ for
// every process we own.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TaggedProc {
  pid: number;
  project: string;
  cmd: string;
  /** started under `crate team` (hosted outside the app) — the sweep never claims it */
  selfHosted?: boolean;
  /** resident memory in KB (0 when unreadable) — the Workspaces menu's memory figure */
  rssKb: number;
}

/** Canonical project path for comparisons (symlinks, /private/var on macOS). */
export function canonProject(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** The value of CRATE_PROJECT inside a macOS `ps -E` line (command + env,
 * space-separated): up to the next ` KEY=` token, so a path with spaces holds. */
export function tagFromPsLine(line: string): string | undefined {
  const m = /(?:^|\s)CRATE_PROJECT=(.+?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|$)/.exec(line);
  return m ? m[1] : undefined;
}

/** Every live process on this host that carries a CRATE_PROJECT tag. */
export function listTagged(): TaggedProc[] {
  const out: TaggedProc[] = [];
  if (existsSync("/proc/self/environ")) {
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const env = readFileSync(`/proc/${d}/environ`, "utf8").split("\0");
        const tag = env.find((e) => e.startsWith("CRATE_PROJECT="));
        if (!tag || tag === "CRATE_PROJECT=") continue;
        const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").join(" ").trim();
        const selfHosted = env.includes("CRATE_SELF_HOSTED=1");
        let rssKb = 0;
        try {
          rssKb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, "utf8"))?.[1] ?? 0);
        } catch {
          /* unreadable — counts as 0 */
        }
        out.push({ pid: Number(d), project: tag.slice("CRATE_PROJECT=".length), cmd, rssKb, ...(selfHosted ? { selfHosted } : {}) });
      } catch {
        /* exited mid-scan, or another user's process */
      }
    }
    return out;
  }
  // macOS: `ps -E` appends the environment for processes we own (the only ones
  // a seat can have started). -ww: never truncate — the tag can sit late.
  let text = "";
  try {
    text = execFileSync("ps", ["-E", "-ww", "-A", "-o", "pid=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return out;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const project = tagFromPsLine(m[3]!);
    const selfHosted = /(?:^|\s)CRATE_SELF_HOSTED=1(?=\s|$)/.test(m[3]!);
    if (project) out.push({ pid: Number(m[1]), project, cmd: m[3]!.slice(0, 160), rssKb: Number(m[2]), ...(selfHosted ? { selfHosted } : {}) });
  }
  return out;
}

/** This process and every ancestor — never signalled. */
export function selfAndAncestors(): Set<number> {
  const keep = new Set<number>([process.pid]);
  let pid = process.ppid;
  for (let i = 0; i < 64 && pid > 1 && !keep.has(pid); i++) {
    keep.add(pid);
    try {
      pid = existsSync(`/proc/${pid}/stat`)
        ? Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ")[1])
        : Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim());
    } catch {
      break;
    }
  }
  return keep;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** SIGTERM, wait up to graceMs, SIGKILL the holdouts. Returns pids still alive. */
export async function terminate(pids: number[], graceMs = 4000): Promise<number[]> {
  const keep = selfAndAncestors();
  const targets = [...new Set(pids)].filter((p) => p > 1 && !keep.has(p));
  for (const p of targets) {
    try {
      process.kill(p, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < graceMs && targets.some(alive)) await new Promise((r) => setTimeout(r, 150));
  for (const p of targets.filter(alive)) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* raced to exit */
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  return targets.filter(alive);
}

/** Tagged processes belonging to one project (canonical match). */
export function taggedFor(project: string, all: TaggedProc[] = listTagged()): TaggedProc[] {
  const want = canonProject(project);
  const keep = selfAndAncestors();
  return all.filter((t) => !keep.has(t.pid) && canonProject(t.project) === want);
}

/** The engine's env minus the seat tags — a helper the engine runs on its own
 * behalf must never be claimed by a later sweep (an EMPTY tag would read as a path). */
function untagged(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CRATE_PROJECT;
  delete env.CRATE_SEAT;
  return env;
}

export interface TeardownReport {
  /** processes closed by the tag sweep (the team's own supervisor already stopped its seats) */
  closed: number;
  /** tagged processes still alive after SIGKILL — the honest "0" check */
  remaining: number;
  /** what `dev-server down` said (undefined when the rig has no dev-server tool) */
  devServer?: string;
}

/**
 * After the team is stopped: take the workspace's dev server down (any backend —
 * `dev-server down` also handles a supervised launchd/systemd unit, which
 * carries no tag) and terminate every process still tagged to it. Returns the
 * count left — Stop's proof.
 */
export async function teardownWorkspace(project: string, opts: { graceMs?: number; skipDevServer?: boolean } = {}): Promise<TeardownReport> {
  let devServer: string | undefined;
  const tool = join(project, ".agents", "bin", "dev-server");
  if (!opts.skipDevServer && existsSync(tool) && existsSync(join(project, ".agents", "rig.conf"))) {
    try {
      devServer = execFileSync("bash", [tool, "down", project], {
        cwd: project,
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
        env: untagged(),
      }).trim().split("\n").pop();
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      devServer = `${err.stderr ?? err.stdout ?? "dev-server down failed"}`.trim().split("\n").pop();
    }
  }
  // Seats are stopping (their supervisor signalled them); give them a beat,
  // then close whatever still carries the tag.
  const t0 = Date.now();
  let left = taggedFor(project);
  while (left.length && Date.now() - t0 < 2000) {
    await new Promise((r) => setTimeout(r, 200));
    left = taggedFor(project);
  }
  const closed = left.length;
  const survivors = closed ? await terminate(left.map((t) => t.pid), opts.graceMs) : [];
  return { closed, remaining: survivors.length ? taggedFor(project).length : 0, ...(devServer !== undefined ? { devServer } : {}) };
}

/**
 * The sweep: close processes tagged to workspaces this engine has on record as
 * NOT running. `stopped` is the canonical-path set of those workspaces
 * (desired=parked, archived, …) — built by the caller from THIS engine's record.
 */
export async function sweepStopped(stopped: Set<string>, graceMs?: number): Promise<{ project: string; closed: number }[]> {
  if (!stopped.size) return [];
  const keep = selfAndAncestors();
  const byProject = new Map<string, number[]>();
  for (const t of listTagged()) {
    if (keep.has(t.pid) || t.selfHosted) continue;
    const p = canonProject(t.project);
    if (!stopped.has(p)) continue;
    byProject.set(p, [...(byProject.get(p) ?? []), t.pid]);
  }
  const report: { project: string; closed: number }[] = [];
  for (const [project, pids] of byProject) {
    await terminate(pids, graceMs);
    report.push({ project, closed: pids.length });
  }
  return report;
}

/** Resident memory (MB) per workspace, from one scan — canonical path → MB.
 * Walled seats whose sandbox wrapper hides its own stats still count their
 * agent processes, which is where the memory lives. */
export function memoryByProject(all: TaggedProc[] = listTagged()): Map<string, number> {
  const mb = new Map<string, number>();
  for (const t of all) {
    const p = canonProject(t.project);
    mb.set(p, (mb.get(p) ?? 0) + t.rssKb / 1024);
  }
  for (const [p, v] of mb) mb.set(p, Math.round(v));
  return mb;
}
