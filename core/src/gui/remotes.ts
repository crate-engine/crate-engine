// Cockpit-first onboarding S1 (PDR dev/pdr/cockpit-first-onboarding.md) —
// the "+ Add a server" machinery: remembered remote engines as chips, an ssh
// probe, and the CONSENT-GATED invisible install (Adam's call: automation
// yes, silent no). Everything rides the user's OWN ssh (BatchMode — keys or
// nothing, never a password prompt wedged in a server process); the install
// is the standard installer, ~/.crate on that machine, own folder, no sudo.
// Pure plans live here exported for tests; side effects go through an
// injectable RemoteExec (the remote.ts pattern, one layer up).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierPaths } from "../usertier.js";
import { parseAppUrl, tunnelPlan } from "./remote.js";

export interface RemoteEntry {
  /** The ssh destination (an alias from ~/.ssh/config or user@host). */
  host: string;
  addedAt: string;
}

export function remotesFile(home: string): string {
  return join(tierPaths(home).root, "remotes.json");
}

export function listRemotes(home: string): RemoteEntry[] {
  const f = remotesFile(home);
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (!Array.isArray(j)) return [];
    return j.filter((e): e is RemoteEntry => e && typeof e.host === "string");
  } catch {
    return []; // a corrupt registry is empty, never a crash (degrade-don't-fail)
  }
}

export function addRemote(home: string, host: string): RemoteEntry[] {
  const all = listRemotes(home);
  if (!all.some((e) => e.host === host)) {
    all.push({ host, addedAt: new Date().toISOString() });
    const { root } = tierPaths(home);
    if (existsSync(root)) writeFileSync(remotesFile(home), JSON.stringify(all, null, 2) + "\n");
  }
  return all;
}

export function removeRemote(home: string, host: string): RemoteEntry[] {
  const all = listRemotes(home).filter((e) => e.host !== host);
  const { root } = tierPaths(home);
  if (existsSync(root)) writeFileSync(remotesFile(home), JSON.stringify(all, null, 2) + "\n");
  return all;
}

/** An ssh destination the card may use: an alias or user@host — plain chars
 * only, so a hostile string can never smuggle ssh options or shell syntax. */
export function validRemoteHost(host: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.@-]*$/.test(host) && !host.startsWith("-");
}

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];

/** The probe: is an engine installed there? (One round-trip, keys or nothing.) */
export function probeArgv(host: string): string[] {
  return [...SSH_OPTS, host, 'test -x "$HOME/.local/bin/crate" && echo CRATE_ENGINE=yes || echo CRATE_ENGINE=no'];
}

export function parseProbe(stdout: string): { engine: boolean } {
  return { engine: /^CRATE_ENGINE=yes$/m.test(stdout) };
}

/** The consent-gated install — the standard installer, verbatim: ~/.crate on
 * that machine + the crate command in ~/.local/bin, no sudo, nothing
 * system-wide. --no-open: a server process must not try to launch a window. */
export function installArgv(host: string): string[] {
  return [...SSH_OPTS, host, "curl -fsSL https://crate-engine.ai/get | bash -s -- --no-open"];
}

/** Boot (or find) the app server on the host — the proven `crate open
 * --remote` first leg, verbatim (cli.ts): headless-boots + writes app-url. */
export function bootArgv(host: string): string[] {
  return [...SSH_OPTS, host, '"$HOME/.local/bin/crate" open'];
}

export function appUrlArgv(host: string): string[] {
  return [...SSH_OPTS, host, "cat ~/.crate/app-url"];
}

// ── the job — one live connect/install per host, polled by the card ──────────

export type RemotePhase = "probing" | "installing" | "booting" | "tunneling" | "connected" | "failed";

export interface RemoteJob {
  host: string;
  phase: RemotePhase;
  /** One honest progress line, plain words. */
  note: string;
  /** Set at phase "connected": the tunneled /team URL the window navigates to. */
  url?: string;
  /** Failure evidence, one click away (stderr tails, step names). */
  log: string[];
  startedAt: string;
}

export interface RemoteExec {
  run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }>;
  spawnDetached(cmd: string, args: string[]): void;
  probeHttp(url: string, timeoutMs: number): Promise<boolean>;
}

export function defaultRemoteExec(): RemoteExec {
  return {
    async run(cmd, args, timeoutMs) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const r = await promisify(execFile)(cmd, args, { timeout: timeoutMs, encoding: "utf8" });
      return { stdout: r.stdout, stderr: r.stderr };
    },
    spawnDetached(cmd, args) {
      // the ssh tunnel outlives the request — it IS the transport (cli.ts law)
      import("node:child_process").then(({ spawn }) => {
        const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
        c.unref();
      });
    },
    async probeHttp(url, timeoutMs) {
      try {
        await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return true; // any HTTP answer through the tunnel = alive
      } catch {
        return false;
      }
    },
  };
}

const jobs = new Map<string, RemoteJob>();

export function remoteJob(host: string): RemoteJob | undefined {
  return jobs.get(host);
}

/** Tests only: forget finished jobs so runs stay hermetic. */
export function clearRemoteJobs(): void {
  jobs.clear();
}

function stderrTail(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  const tail = (err.stderr ?? "").trim().split("\n").slice(-3).join("\n");
  return tail || err.message || String(e);
}

/** The connect leg (shared by both jobs): boot the remote app server, read
 * its handshake, tunnel, verify, remember the host. Mutates the job. */
async function runConnect(job: RemoteJob, home: string, exec: RemoteExec): Promise<void> {
  job.phase = "booting";
  job.note = `booting the engine on ${job.host}…`;
  await exec.run("ssh", bootArgv(job.host), 120_000);
  job.log.push("boot: crate open answered");
  const { stdout } = await exec.run("ssh", appUrlArgv(job.host), 20_000);
  const app = parseAppUrl(stdout);
  if (!app) throw new Error(`no app url on ${job.host} (~/.crate/app-url) — the engine did not come up`);
  const plan = tunnelPlan(app, job.host);
  job.phase = "tunneling";
  job.note = `connecting — tunneling to ${job.host}…`;
  exec.spawnDetached("ssh", plan.tunnelArgv);
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 15_000 && !up) {
    await new Promise((r) => setTimeout(r, 500));
    up = await exec.probeHttp(plan.probeUrl, 1500);
  }
  if (!up) {
    throw new Error(
      `the tunnel to ${job.host}:${app.port} did not come up — is local port ${app.port} taken? (stop whatever holds it and retry)`,
    );
  }
  addRemote(home, job.host); // connected once = a remembered chip forever
  job.url = plan.teamUrl;
  job.phase = "connected";
  job.note = `connected — ${job.host} is ready`;
}

function startJob(
  home: string,
  host: string,
  exec: RemoteExec,
  first: (job: RemoteJob) => Promise<void>,
): RemoteJob {
  const live = jobs.get(host);
  if (live && live.phase !== "failed" && live.phase !== "connected") return live; // one job per host
  const job: RemoteJob = { host, phase: "probing", note: `reaching ${host} over ssh…`, log: [], startedAt: new Date().toISOString() };
  jobs.set(host, job);
  void (async () => {
    try {
      await first(job);
      await runConnect(job, home, exec);
    } catch (e) {
      job.phase = "failed";
      job.note = e instanceof Error ? e.message : String(e);
      job.log.push(stderrTail(e));
    }
  })();
  return job;
}

/** Probe only (the add flow's first step — BEFORE any consent dialog). */
export async function probeRemote(
  host: string,
  exec: RemoteExec = defaultRemoteExec(),
): Promise<{ reachable: boolean; engine: boolean; note?: string }> {
  try {
    const { stdout } = await exec.run("ssh", probeArgv(host), 20_000);
    return { reachable: true, ...parseProbe(stdout) };
  } catch (e) {
    return {
      reachable: false,
      engine: false,
      note:
        `ssh could not reach ${host} with your keys — ` +
        `check the alias/keys in ~/.ssh/config, then retry. (${stderrTail(e).split("\n").pop() ?? ""})`,
    };
  }
}

/** Connect to a host that already has an engine (a remembered chip's click). */
export function startConnect(home: string, host: string, exec: RemoteExec = defaultRemoteExec()): RemoteJob {
  return startJob(home, host, exec, async () => {
    /* no pre-step — runConnect carries it from here */
  });
}

/** CONSENT GIVEN (the one dialog's [Install engine]): run the standard
 * installer over the user's ssh, then connect. Never called without the
 * page's explicit consent click — the server offers no silent path to it. */
export function startInstall(home: string, host: string, exec: RemoteExec = defaultRemoteExec()): RemoteJob {
  return startJob(home, host, exec, async (job) => {
    job.phase = "installing";
    job.note = `installing the engine on ${job.host} (~/.crate, no sudo)…`;
    const r = await exec.run("ssh", installArgv(job.host), 600_000);
    job.log.push("install: " + (r.stdout.trim().split("\n").pop() ?? "done"));
  });
}
