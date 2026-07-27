// PHASE-8 T4 (D12) — the context REFRESH (session swap) + the impeccable-
// context law. Refreshing a seat drops its persisted session so the NEXT
// turn re-orients cleanly from the state files (the headless equivalent of
// .recover). It is REFUSED while the seat's state file is stale relative to
// its last turn — because a fresh session that reads an out-of-date state
// file would lose work. That refusal is what makes refresh lossless.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sessionFile, turnsDir } from "./runner.js";

/** epoch ms from a turn file's ISO name (colons became dashes on write). */
function startMsFromName(name: string): number {
  const iso = name.replace(".jsonl", "").replace(/T(\d\d)-(\d\d)-(\d\d)/, "T$1:$2:$3");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

interface TurnInfo { complete: boolean; startMs: number }

/** The newest turn's completeness + START time. The START matters (not the
 * file mtime): the agent writes its state DURING the turn, but the runner
 * finalizes the turn file ~seconds later — comparing state to the file's
 * mtime would flag every real turn as stale. */
function newestTurn(projectRoot: string, seat: string): TurnInfo | undefined {
  const dir = join(projectRoot, ".agents", "state", "turns", seat);
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const name = files[files.length - 1];
  if (!name) return undefined;
  const lines = readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean);
  const meta = lines.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; } }).find((d) => d.turnMeta);
  const startMs = (meta?.startedAt ? Date.parse(meta.startedAt as string) : undefined) || startMsFromName(name);
  return { complete: Boolean(meta), startMs };
}

/** The freshness law: a refresh is safe iff the seat is NOT mid-turn AND its
 * state file was written at/after the latest turn's START (so the state
 * reflects that turn's work). No turns yet = fresh (nothing to lose). */
export function stateIsFresh(projectRoot: string, seat: string): boolean {
  const t = newestTurn(projectRoot, seat);
  if (!t) return true; // no turns
  if (!t.complete) return false; // mid-turn — never refresh under a running turn
  const stateFile = join(projectRoot, ".agents", "state", `${seat}.md`);
  if (!existsSync(stateFile)) return false; // work happened but no state written
  return statSync(stateFile).mtimeMs + 1000 >= t.startMs; // state written during/after the turn
}

export interface RefreshResult {
  ok: boolean;
  reason?: string;
}

/** Drop a seat's session so its next turn starts fresh. Refused on stale
 * state unless force=true. */
export function refreshSeat(projectRoot: string, seat: string, opts: { force?: boolean } = {}): RefreshResult {
  if (!opts.force && !stateIsFresh(projectRoot, seat)) {
    return {
      ok: false,
      reason: `${seat}'s state file is stale (older than its last turn) — a refresh now would lose work. ` +
        `Let the seat finish its current turn (which updates the state), then refresh; or force to override.`,
    };
  }
  const f = sessionFile(projectRoot, seat);
  if (existsSync(f)) rmSync(f);
  mkdirSync(turnsDir(projectRoot, seat), { recursive: true });
  appendFileSync(
    join(turnsDir(projectRoot, seat), "turns.log"),
    `${new Date().toISOString()} | refreshed${opts.force ? " (forced)" : ""} | session dropped — next turn re-orients from state\n`,
  );
  return { ok: true };
}
