// CE-190 — the ENGINE owns the Design Studio preview for static sites, and it
// runs ONLY while someone is using it (Adam, 2026-09-24: "I only want them open
// when the Design Studio windows are open … avoid dev server and background
// bloat that I can't see"). Before: the designer started its own
// `python3 -m http.server` inside its session, so every engine restart killed
// the preview mid-review, and nothing ever closed it on purpose.
//
// Scope: projects with NO dev command (serve-resolve dev → none) that the gate
// would serve STATIC (a root index.html) — the preview IS the tree. An app
// project's preview is its main dev server (coder + QA use it too), which keeps
// its own rules; nothing here touches it.
//
// "In use" is any of:
//   - a Design Studio window checking in (its 4s poll: /api/studio/state?viewer=…)
//   - traffic through the workspace's preview proxy (Launch in Chrome, a phone)
//   - the designer's lease: `agentctl studio-serve` writes
//     .agents/state/studio-demand.json {until}, 20 minutes per call
// Nobody using it for GRACE → it stops. Stop / the sweep close it too: the
// child carries CRATE_PROJECT like every seat process ("stopped means zero").
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

export const VIEWER_TTL_MS = 12_000; // a Studio window polls every 4s — three misses = closed
export const PROXY_TTL_MS = 30_000; // a page viewed through the proxy (Chrome, phone)
export const GRACE_MS = 120_000; // closing + reopening a window never restarts it

export interface StudioPlan {
  port: number;
  bind: string;
  /** node + static-serve.js + args */
  argv: string[];
}

export interface StudioStatus {
  managed: true;
  running: boolean;
  port: number;
  /** Studio windows checking in right now */
  windows: number;
  designer: boolean;
  /** ms until it stops (only when running and nobody is using it) */
  stopsInMs?: number;
  /** why it could not start (e.g. the port is held by someone else) */
  blocked?: string;
}

/** How this project would be previewed by the engine — undefined when the
 * project has a real dev command (its dev server is the preview) or nothing
 * static to serve. Reads the ONE serve resolution (bin/serve-resolve). */
export function studioPlan(projectRoot: string, engineBin: string): StudioPlan | undefined {
  const resolve = (kind: string): Record<string, string> => {
    try {
      const out = execFileSync("bash", [join(engineBin, "serve-resolve"), kind, projectRoot], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
      return Object.fromEntries(out.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    } catch {
      return {};
    }
  };
  // serve-resolve reports a plain-HTML site as MODE=static (dev AND gate);
  // prod/dev = a real app whose own dev server is the preview — not ours.
  const dev = resolve("dev");
  if (dev.MODE !== "static") return undefined;
  const port = Number(dev.PORT);
  if (!port) return undefined;
  let bind = "127.0.0.1";
  try {
    const m = /^\s*DEV_BIND=["']?([^"'\s]+)/m.exec(readFileSync(join(projectRoot, ".agents", "rig.conf"), "utf8"));
    if (m) bind = m[1]!;
  } catch {
    /* no rig.conf bind — loopback */
  }
  return { port, bind, argv: [process.execPath, join(engineBin, "static-serve.js"), String(port), projectRoot] };
}

/** Is anything already listening on the port? */
function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => {
      s.destroy();
      resolve(false);
    });
  });
}

interface Entry {
  plan: StudioPlan;
  child?: ChildProcess;
  viewers: Map<string, number>;
  proxyAt: number;
  /** last moment anyone wanted it (drives the grace countdown) */
  wantedAt: number;
  blocked?: string;
  starting?: boolean;
}

export function demandPath(projectRoot: string): string {
  return join(projectRoot, ".agents", "state", "studio-demand.json");
}

function designerLeaseUntil(projectRoot: string): number {
  try {
    const d = JSON.parse(readFileSync(demandPath(projectRoot), "utf8")) as { until?: string | number };
    const t = typeof d.until === "number" ? d.until : Date.parse(String(d.until ?? ""));
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

/** One per engine: the on-demand Studio preview servers of every workspace. */
export class StudioServers {
  private entries = new Map<string, Entry>();
  private plans = new Map<string, StudioPlan | null>();
  constructor(
    private readonly engineBin: string,
    private readonly log: (line: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cached plan (serve-resolve runs once per project per engine start). */
  plan(projectRoot: string): StudioPlan | undefined {
    if (!this.plans.has(projectRoot)) this.plans.set(projectRoot, studioPlan(projectRoot, this.engineBin) ?? null);
    return this.plans.get(projectRoot) ?? undefined;
  }

  private entry(projectRoot: string): Entry | undefined {
    const plan = this.plan(projectRoot);
    if (!plan) return undefined;
    let e = this.entries.get(projectRoot);
    if (!e) {
      e = { plan, viewers: new Map(), proxyAt: 0, wantedAt: 0 };
      this.entries.set(projectRoot, e);
    }
    return e;
  }

  /** A Studio window checked in. Returns true when this project is engine-served. */
  touchViewer(projectRoot: string, viewer: string): boolean {
    const e = this.entry(projectRoot);
    if (!e) return false;
    e.viewers.set(viewer, this.now());
    return true;
  }

  /** Traffic through the workspace's preview proxy. */
  touchProxy(projectRoot: string): void {
    const e = this.entries.get(projectRoot); // proxy traffic never CREATES an entry — it only renews one
    if (e) e.proxyAt = this.now();
  }

  private users(projectRoot: string, e: Entry): { windows: number; designer: boolean; proxy: boolean } {
    const t = this.now();
    for (const [k, at] of e.viewers) if (t - at > VIEWER_TTL_MS) e.viewers.delete(k);
    return { windows: e.viewers.size, designer: designerLeaseUntil(projectRoot) > t, proxy: t - e.proxyAt < PROXY_TTL_MS };
  }

  /** Start/stop to match demand. `running` = the workspaces allowed to serve at all. */
  async tick(running: Set<string>): Promise<void> {
    // a designer lease can create an entry (the designer asked before any window opened)
    for (const p of running) if (!this.entries.has(p) && designerLeaseUntil(p) > this.now()) this.entry(p);
    for (const [p, e] of this.entries) {
      const u = this.users(p, e);
      const wanted = running.has(p) && (u.windows > 0 || u.designer || u.proxy);
      const alive = !!e.child && e.child.exitCode === null && !e.child.killed;
      if (wanted) e.wantedAt = this.now();
      if (wanted && !alive && !e.starting) await this.start(p, e);
      else if (!wanted && alive && (!running.has(p) || this.now() - e.wantedAt > GRACE_MS)) this.stop(p, e, running.has(p) ? "nobody has used it for 2 minutes" : "the workspace is not running");
      else if (!wanted && !alive && !running.has(p)) this.entries.delete(p);
    }
  }

  private async start(projectRoot: string, e: Entry): Promise<void> {
    e.starting = true;
    try {
      if (await portBusy(e.plan.port)) {
        // someone else holds the port (e.g. a hand-started server) — never fight it
        if (!e.blocked) this.log(`studio preview: ${projectRoot} — port ${e.plan.port} is already in use; not starting the engine preview`);
        e.blocked = `port ${e.plan.port} is already in use by another server`;
        return;
      }
      e.blocked = undefined;
      const env: NodeJS.ProcessEnv = { ...process.env, CRATE_PROJECT: projectRoot, STATIC_SERVE_BIND: e.plan.bind };
      delete env.CRATE_SEAT;
      e.child = spawn(e.plan.argv[0]!, e.plan.argv.slice(1), { cwd: projectRoot, env, stdio: "ignore" });
      e.child.on("exit", () => {
        if (e.child && e.child.exitCode !== null) e.child = undefined;
      });
      this.log(`studio preview: ${projectRoot} — started on port ${e.plan.port} (in use)`);
    } finally {
      e.starting = false;
    }
  }

  private stop(projectRoot: string, e: Entry, why: string): void {
    try {
      e.child?.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    e.child = undefined;
    e.viewers.clear();
    this.log(`studio preview: ${projectRoot} — stopped (${why})`);
  }

  /** Stop everything (engine shutdown). */
  stopAll(): void {
    for (const [p, e] of this.entries) if (e.child) this.stop(p, e, "the engine is shutting down");
  }

  /** What the Dev Servers panel and the Studio show. */
  status(projectRoot: string): StudioStatus | undefined {
    const e = this.entries.get(projectRoot) ?? (this.plan(projectRoot) ? this.entry(projectRoot) : undefined);
    if (!e) return undefined;
    const u = this.users(projectRoot, e);
    const running = !!e.child && e.child.exitCode === null && !e.child.killed;
    const inUse = u.windows > 0 || u.designer || u.proxy;
    return {
      managed: true,
      running,
      port: e.plan.port,
      windows: u.windows,
      designer: u.designer,
      ...(running && !inUse ? { stopsInMs: Math.max(0, GRACE_MS - (this.now() - e.wantedAt)) } : {}),
      ...(e.blocked ? { blocked: e.blocked } : {}),
    };
  }
}
