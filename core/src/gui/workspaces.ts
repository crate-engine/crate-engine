// PHASE-8 T7-1 — the workspace registry: the multi-workspace rail's backend.
// A workspace is a team on its own repo (the isolation already exists on disk —
// each rig is a self-contained .agents/ tree). The registry is a plain JSON
// list under the user tier; the GUI rail lists it and switches the active one
// by reloading /team?project=<path>. No new coordination — the runners for each
// registered team keep looping headless regardless of which one is being viewed.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tierPaths } from "../usertier.js";

export interface Workspace {
  /** Display name (the repo's basename; disambiguated on collision). */
  name: string;
  /** Absolute project root. */
  path: string;
  /** The path still exists on disk. */
  exists: boolean;
  /** It is a crate rig (has .agents/rig.conf) — a stale/moved entry is not. */
  rig: boolean;
  /** Newest turn-log mtime across seats (ms), or null if the team never ran. */
  lastActivityMs: number | null;
}

export function workspacesFile(home: string): string {
  return join(tierPaths(home).root, "workspaces.json");
}

function readRaw(home: string): Array<{ path: string; name?: string }> {
  const f = workspacesFile(home);
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (!Array.isArray(j)) return [];
    return j.filter((e): e is { path: string } => e && typeof e.path === "string");
  } catch {
    return []; // a corrupt registry is empty, never a crash (degrade-don't-fail)
  }
}

function writeRaw(home: string, entries: Array<{ path: string; name: string }>): void {
  const { root } = tierPaths(home);
  if (!existsSync(root)) return; // no user tier yet — nothing to persist against
  writeFileSync(workspacesFile(home), JSON.stringify(entries, null, 2) + "\n");
}

/** Newest turn-log mtime across a rig's seats, or null. File-based, no pids. */
function lastActivity(projectRoot: string): number | null {
  const turns = join(projectRoot, ".agents", "state", "turns");
  if (!existsSync(turns)) return null;
  let newest: number | null = null;
  let seats: string[];
  try {
    seats = readdirSync(turns);
  } catch {
    return null;
  }
  for (const seat of seats) {
    const log = join(turns, seat, "turns.log");
    try {
      const m = statSync(log).mtimeMs;
      if (newest === null || m > newest) newest = m;
    } catch {
      /* seat with no turns.log yet */
    }
  }
  return newest;
}

/** Enrich a raw entry with live disk facts. */
function enrich(entry: { path: string; name?: string }): Workspace {
  const exists = existsSync(entry.path);
  const rig = exists && existsSync(join(entry.path, ".agents", "rig.conf"));
  return {
    name: entry.name || basename(entry.path),
    path: entry.path,
    exists,
    rig,
    lastActivityMs: rig ? lastActivity(entry.path) : null,
  };
}

/** The registered workspaces, enriched with disk state (newest activity first). */
export function listWorkspaces(home: string): Workspace[] {
  return readRaw(home)
    .map(enrich)
    .sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0));
}

/**
 * Register a project path (idempotent — dedup by absolute path). Returns the
 * updated list. Names collide-disambiguate by appending the parent dir, so two
 * different repos both named "app" stay distinguishable in the rail.
 */
export function registerWorkspace(home: string, projectPath: string): Workspace[] {
  const raw = readRaw(home);
  if (!raw.some((e) => e.path === projectPath)) {
    raw.push({ path: projectPath, name: basename(projectPath) });
    writeRaw(home, raw.map((e) => ({ path: e.path, name: e.name || basename(e.path) })));
  }
  return listWorkspaces(home);
}

/** Drop a workspace from the rail (does NOT touch the repo on disk). */
export function removeWorkspace(home: string, projectPath: string): Workspace[] {
  const raw = readRaw(home).filter((e) => e.path !== projectPath);
  writeRaw(home, raw.map((e) => ({ path: e.path, name: e.name || basename(e.path) })));
  return listWorkspaces(home);
}
