// PHASE-8 T7-1 — the workspace registry: the multi-workspace rail's backend.
// A workspace is a team on its own repo (the isolation already exists on disk —
// each rig is a self-contained .agents/ tree). The registry is a plain JSON
// list under the user tier; the GUI rail lists it and switches the active one
// by reloading /team?project=<path>. No new coordination — the runners for each
// registered team keep looping headless regardless of which one is being viewed.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tierPaths } from "../usertier.js";

/** Workspace lifecycle (PDR dev/pdr/workspace-lifecycle.md, decision 2):
 * a workspace is Running or Parked; `desired` is the persisted RECORD of
 * which — it replaces the single global ~/.crate/last-project. Restart
 * resumes exactly what the record says (never more), and focus (`focusedAt`)
 * is a VIEW default with zero lifecycle consequence. */
export type WorkspaceDesired = "running" | "parked";

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
  /** The lifecycle RECORD: what should be running (default parked). */
  desired: WorkspaceDesired;
  /** View default: when a window last focused this workspace (ms), if ever. */
  focusedAt?: number;
}

interface RawEntry {
  path: string;
  name?: string;
  desired?: WorkspaceDesired;
  focusedAt?: number;
}

export function workspacesFile(home: string): string {
  return join(tierPaths(home).root, "workspaces.json");
}

function readRaw(home: string): RawEntry[] {
  const f = workspacesFile(home);
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (!Array.isArray(j)) return [];
    return j.filter((e): e is RawEntry => e && typeof e.path === "string");
  } catch {
    return []; // a corrupt registry is empty, never a crash (degrade-don't-fail)
  }
}

function writeRaw(home: string, entries: RawEntry[]): void {
  const { root } = tierPaths(home);
  if (!existsSync(root)) return; // no user tier yet — nothing to persist against
  writeFileSync(
    workspacesFile(home),
    JSON.stringify(
      entries.map((e) => ({ ...e, name: e.name || basename(e.path) })),
      null,
      2,
    ) + "\n",
  );
}

/** Mutate one entry's record fields (registering the path if absent). */
function patchEntry(home: string, projectPath: string, patch: Partial<RawEntry>): void {
  const raw = readRaw(home);
  const cur = raw.find((e) => e.path === projectPath);
  if (cur) Object.assign(cur, patch);
  else raw.push({ path: projectPath, name: basename(projectPath), ...patch });
  writeRaw(home, raw);
}

/** Record the lifecycle intent — boot/staff mark running, a scoped stop
 * marks parked. This is the ONLY thing restart-resume reads. */
export function setWorkspaceDesired(home: string, projectPath: string, desired: WorkspaceDesired): void {
  patchEntry(home, projectPath, { desired });
}

/** Record a focus (a VIEW default — used only to pick where a bare
 * `crate open` / project-less window lands; never touches lifecycle). */
export function setWorkspaceFocused(home: string, projectPath: string): void {
  // Monotonic: two focuses in the same millisecond must still order — the
  // newest focus IS the bare-open default, so ties cannot be left to chance.
  const newest = Math.max(...readRaw(home).map((e) => e.focusedAt ?? 0), 0);
  patchEntry(home, projectPath, { focusedAt: Math.max(Date.now(), newest + 1) });
}

/** Every workspace the record says should be running (rig-validated). */
export function desiredRunning(home: string): string[] {
  return listWorkspaces(home)
    .filter((w) => w.desired === "running" && w.rig)
    .map((w) => w.path);
}

/** The newest-focused valid rig — the view default for a bare open. */
export function lastFocusedWorkspace(home: string): string | undefined {
  return listWorkspaces(home)
    .filter((w) => w.rig && w.focusedAt !== undefined)
    .sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))[0]?.path;
}

/** One-time migration: the old single global ~/.crate/last-project becomes
 * that workspace's focusedAt + desired=running (it was the auto-booted one),
 * then the file is retired. Idempotent — a missing file is a no-op. */
export function migrateLastProject(home: string): void {
  const f = join(tierPaths(home).root, "last-project");
  if (!existsSync(f)) return;
  try {
    const p = readFileSync(f, "utf8").trim();
    if (p !== "" && existsSync(join(p, ".agents"))) {
      patchEntry(home, p, { desired: "running", focusedAt: Date.now() });
    }
  } catch {
    /* unreadable relic — just retire it */
  }
  try {
    rmSync(f);
  } catch {
    /* best-effort */
  }
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
function enrich(entry: RawEntry): Workspace {
  const exists = existsSync(entry.path);
  const rig = exists && existsSync(join(entry.path, ".agents", "rig.conf"));
  return {
    name: entry.name || basename(entry.path),
    path: entry.path,
    exists,
    rig,
    lastActivityMs: rig ? lastActivity(entry.path) : null,
    desired: entry.desired ?? "parked",
    ...(entry.focusedAt !== undefined ? { focusedAt: entry.focusedAt } : {}),
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
    writeRaw(home, raw);
  }
  return listWorkspaces(home);
}

/** Drop a workspace from the rail (does NOT touch the repo on disk). */
export function removeWorkspace(home: string, projectPath: string): Workspace[] {
  writeRaw(home, readRaw(home).filter((e) => e.path !== projectPath));
  return listWorkspaces(home);
}
