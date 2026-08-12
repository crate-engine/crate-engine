// Native seat access (PDR native-seat-access, 2026-08-10) — the second door.
//
// Autonomous turns drive a seat through the headless machine channel
// (runner.ts). This module opens the OTHER door on the SAME session: the
// agent's real interactive TUI (claude/codex/pi) in a server-side PTY,
// spawned inside the seat's identical wall, streamed to the ⚡ window.
// While a TTY is open the seat is "attended" (runner holds turns; mail
// queues); on exit the hold releases and — for claude, whose interactive
// resume forks a NEW session id — the seat's session file is re-pointed at
// the fork so the next headless turn remembers what the human did.
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  attendedFile,
  isTurnActive,
  seatEnv,
  sessionFile,
  turnsDir,
} from "./runner.js";
import { normalizeAgent, resolveHeadlessWall } from "./wall.js";

/** The interactive (TUI) argv for one agent — the same session the headless
 * door resumes, opened the way the CLI was built to be used. Permission
 * posture (REVISED by Adam, 2026-08-11, after real driving): a WALLED wheel
 * bypasses claude's own approvals, same as the headless seats — approving
 * every edit was pure friction when the wall already cages all writes to
 * the project + doors. No wall → no bypass, same law as everywhere. */
/** The identity a wheel session is born with — who it is, where its laws
 * live, and the one law that must survive even a human conversation. */
export function seatIdentityPrompt(seat: string): string {
  const base =
    `You are the ${seat || "(unstaffed)"} seat of this project's Crate Engine rig — a five-seat AI dev team ` +
    `(orchestrator, coder, reviewer, designer, tester/QA) coordinated through .agents/. Your role binder is ` +
    `.agents/config/${seat}.md — read it before acting on team matters; its laws bind this session too. ` +
    `Team coordination happens via python3 .agents/bin/agentctl.py (emit transitions, deliver mail) — never by you ` +
    `doing another seat's job.`;
  if (seat === "orchestrator") {
    return (
      base +
      ` THE ORCHESTRATOR LAW HOLDS AT THE WHEEL: you coordinate, you NEVER produce the work yourself. When the ` +
      `operator asks for a feature or fix, dispatch it — emit start_impl and deliver a complete brief to the coder ` +
      `via agentctl — do not write the code, tests, or designs in this session.`
    );
  }
  return base;
}

export function buildInteractiveInvocation(
  agentArg: string,
  opts: { sessionId?: string; model?: string; walled?: boolean; seat?: string } = {},
): string[] {
  const agent = normalizeAgent(agentArg);
  const { sessionId, model } = opts;
  switch (agent) {
    case "claude": {
      // Seat identity (flaw #9, Adam's first loop kickoff, 2026-08-11): a
      // wheel session opened as RAW claude — no binder, no role — so the
      // "orchestrator" cheerfully built the feature itself instead of
      // dispatching the team. Every wheel now carries its seat's identity.
      const argv = ["claude"];
      if (opts.seat) argv.push("--append-system-prompt", seatIdentityPrompt(opts.seat));
      if (opts.walled) argv.push("--permission-mode", "bypassPermissions");
      if (model) argv.push("--model", model);
      if (sessionId) argv.push("--resume", sessionId);
      return argv;
    }
    case "codex": {
      // resume-first (T0: `codex resume <thread>` continues the thread the
      // headless turns built). Model only when staffed non-empty — the codex
      // catalog entry deliberately rides the account default.
      const argv = sessionId ? ["codex", "resume", sessionId] : ["codex"];
      if (model) argv.push("--model", model);
      return argv;
    }
    case "pi": {
      const argv = ["pi"];
      if (model) {
        argv.push("--provider", model.split("/")[0]!, "--model", model.split("/").slice(1).join("/"));
      }
      if (sessionId) argv.push("--session-id", sessionId);
      return argv;
    }
    default:
      throw new Error(
        `the ${agent} seat has no interactive door yet — claude/codex/pi only (v1); ` +
          `the pattern extends once the wired seats earn battle-testing.`,
      );
  }
}

/** The seat's session id as the TTY door should open it. Mirrors the
 * runner's semantics (pi pre-mints so both doors share one session). */
export function ttySessionId(projectRoot: string, seat: string, agentArg: string): string | undefined {
  const agent = normalizeAgent(agentArg);
  const f = sessionFile(projectRoot, seat);
  if (existsSync(f)) {
    try {
      const j = JSON.parse(readFileSync(f, "utf8")) as { agent?: string; sessionId?: string };
      if (j.agent === agent && j.sessionId) return j.sessionId;
    } catch {
      /* unreadable = fresh */
    }
  }
  if (agent === "pi") {
    const sid = randomUUID();
    writeFileSync(f, JSON.stringify({ agent, sessionId: sid }));
    return sid;
  }
  return undefined;
}

/** Claude Code stores sessions per munged-cwd: non-alphanumerics become "-"
 * (verified against a live ~/.claude/projects). */
export function claudeProjectDir(projectRoot: string, home: string): string {
  return join(home, ".claude", "projects", projectRoot.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** Newest session file (basename sans .jsonl) touched at/after sinceMs. */
export function newestClaudeSession(dir: string, sinceMs: number): string | undefined {
  let best: string | undefined;
  let bestM = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const f of names) {
    if (!f.endsWith(".jsonl")) continue;
    try {
      const m = statSync(join(dir, f)).mtimeMs;
      if (m >= sinceMs && m > bestM) {
        bestM = m;
        best = f.slice(0, -".jsonl".length);
      }
    } catch {
      /* raced a deletion */
    }
  }
  return best;
}

/**
 * The handback seam: after a claude TUI closes, point the seat's session
 * file at the session the human actually drove (interactive resume FORKS a
 * new id — without this, the next headless turn would resume the pre-drop-in
 * memory and lose everything the human did). Falls back to scanning every
 * claude project dir when the munged dir yields nothing (belt + braces on
 * the munge rule). No-op for codex/pi (ids observed stable across doors —
 * live-confirm rides the first battle-test drop-in).
 */
export function repointSessionAfterTty(
  projectRoot: string,
  seat: string,
  agentArg: string,
  sinceMs: number,
  home: string = homedir(),
): string | undefined {
  const agent = normalizeAgent(agentArg);
  if (agent !== "claude") return undefined;
  let root = projectRoot;
  try {
    root = realpathSync(projectRoot);
  } catch {
    /* keep as given */
  }
  let sid = newestClaudeSession(claudeProjectDir(root, home), sinceMs);
  if (!sid) {
    const base = join(home, ".claude", "projects");
    try {
      for (const d of readdirSync(base)) {
        const cand = newestClaudeSession(join(base, d), sinceMs);
        if (cand) sid = cand; // any project dir — newest wins across the scan
      }
    } catch {
      /* no claude home = nothing to re-point */
    }
  }
  if (!sid) return undefined;
  const f = sessionFile(projectRoot, seat);
  let prev: string | undefined;
  try {
    prev = (JSON.parse(readFileSync(f, "utf8")) as { sessionId?: string }).sessionId;
  } catch {
    /* fresh */
  }
  if (sid === prev) return undefined;
  writeFileSync(f, JSON.stringify({ agent, sessionId: sid }));
  return sid;
}

// ── the live PTY registry (one per project|seat, held by the GUI server) ──

export interface TtyEvent {
  data?: Buffer;
  exit?: { code: number };
}

/** Blended-pane (PDR blended-pane, S1): the quiet-composer gate is pure
 * keystroke-timestamp inference — write() is the ONE human chokepoint (web
 * cockpit xterm → POST /api/tty/input → here), so no screen parsing is ever
 * needed. composerDirty tracks a likely half-typed draft: printable bytes set
 * it; CR/Ctrl+C/Esc clear it (submit/cancel empties the composer). CSI
 * sequences (arrow keys etc.) are stripped first — cursor movement is not
 * typing, and counting the 'A' of ESC[A as a draft would demand the long
 * quiet for every arrow press. */
export function updateComposerDirty(prev: boolean, data: Buffer): boolean {
  const text = data.toString("latin1").replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "\x1b");
  let dirty = prev;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d || c === 0x0a || c === 0x03 || c === 0x1b) dirty = false;
    else if (c >= 0x20 && c !== 0x7f) dirty = true;
  }
  return dirty;
}

/** Blended pi seats crash under old system node (live probe, superman
 * 2026-08-12: pi 0.84.1 + node v20 dies at import — undici
 * markAsUncloneable TypeError; works under node >= 22). Pick the newest
 * nvm-installed node >= 22 so the spawn env can prepend its bin. Pure over
 * an injected version list. */
export function pickPiNodeVersion(versions: string[]): string | undefined {
  let best: string | undefined;
  let bestKey: number[] = [];
  for (const v of versions) {
    const m = v.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const key = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (key[0]! < 22) continue;
    if (!best || key[0]! > bestKey[0]! || (key[0] === bestKey[0] && (key[1]! > bestKey[1]! || (key[1] === bestKey[1] && key[2]! > bestKey[2]!)))) {
      best = v;
      bestKey = key;
    }
  }
  return best;
}

function piNodeBinDir(home: string): string | undefined {
  const base = join(home, ".nvm", "versions", "node");
  try {
    const v = pickPiNodeVersion(readdirSync(base));
    return v ? join(base, v, "bin") : undefined;
  } catch {
    return undefined; // no nvm — the system node carries it (or pi refuses honestly)
  }
}

export interface TtySeat {
  seat: string;
  projectRoot: string;
  agent: string;
  startedAtMs: number;
  cols: number;
  rows: number;
  exited?: { code: number };
  /** Blended-pane: this PTY is an engine-owned live session (no attended
   * hold, no hand-back; the engine delivers team mail into it). */
  blended?: boolean;
  /** Last HUMAN keystroke (write()); inject() never bumps it — the quiet-
   * composer gate must measure only the human. */
  lastHumanInputMs?: number;
  /** Likely half-typed human draft in the composer (see updateComposerDirty). */
  composerDirty: boolean;
  /** The live session id, once the blend supervisor discovers it. */
  sessionId?: string;
  /** The HUMAN door: stamps lastHumanInputMs + composerDirty. */
  write(data: Buffer): void;
  /** The ENGINE door: writes to the PTY without touching the human
   * timestamps (deliveries must not look like typing to the quiet gate). */
  inject(data: Buffer | string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  subscribe(cb: (ev: TtyEvent) => void): () => void;
  /** Everything the terminal has shown so far (ring-capped) — the replay a
   * (re)connecting viewer paints before going live. */
  replay(): Buffer;
}

const REPLAY_CAP = 256 * 1024;

const registry = new Map<string, TtySeat>();
const keyOf = (projectRoot: string, seat: string) => `${projectRoot}|${seat}`;

export function liveTty(projectRoot: string, seat: string): TtySeat | undefined {
  const t = registry.get(keyOf(projectRoot, seat));
  return t && !t.exited ? t : undefined;
}

/** Every live TTY of one project — the multiplexed stream's roster. */
export function liveTtyList(projectRoot: string): TtySeat[] {
  const out: TtySeat[] = [];
  for (const [k, t] of registry) {
    if (k.startsWith(`${projectRoot}|`) && !t.exited) out.push(t);
  }
  return out;
}

export type StartTtyResult =
  | { ok: true; tty: TtySeat; reattached: boolean }
  | { ok: false; busy: true }
  | { ok: false; error: string };

export interface StartTtyOpts {
  projectRoot: string;
  seat: string;
  agent: string;
  model?: string;
  cols?: number;
  rows?: number;
  home?: string;
  /** Blended-pane (PDR): spawn as an engine-owned live session — no attended
   * hold (the seat is never held), no session re-point on exit (one door,
   * nothing forks; the blend supervisor owns respawn). */
  blended?: boolean;
  /** Tests only: replace the real agent argv (and skip the wall) — the PTY
   * lifecycle/registry seams need a spawnable stub where no agent CLI exists,
   * the same reason runner.ts carries invocationOverride. */
  argvOverride?: string[];
}

/**
 * Open (or reattach) the seat's interactive door. Refuses `busy` while a
 * headless turn is mid-flight — two doors, never two writers on one session.
 * Throws nothing: wall refusals and spawn failures come back as { error }.
 */
export async function startSeatTty(opts: StartTtyOpts): Promise<StartTtyResult> {
  const { projectRoot, seat } = opts;
  const agent = normalizeAgent(opts.agent);
  const blended = opts.blended === true;
  const existing = liveTty(projectRoot, seat);
  if (existing) return { ok: true, tty: existing, reattached: true };
  // Kept for blended too: it protects the transition window while a headless
  // turn is still mid-flight on a just-flagged seat.
  if (isTurnActive(projectRoot, seat)) return { ok: false, busy: true };

  let argv: string[];
  // CRATE_WALLED (FLAWS "browser-tooling"): same stamp the runner puts on a
  // walled headless turn — in-box tools (the agent-browser shim) key
  // chromium's --no-sandbox injection off it, because a nested sandbox init
  // inside the wall is refused by the OS. The TTY door is the same session
  // behind the same wall, so it carries the same marker.
  let walled = false;
  if (opts.argvOverride) {
    argv = opts.argvOverride; // tests: a spawnable stub, no wall to render
  } else {
    try {
      // The SAME wall the runner renders — cwd = project root, same doors,
      // same refusal physics. Interactivity and containment are independent.
      const wall = resolveHeadlessWall(projectRoot, seat, agent);
      walled = wall !== undefined;
      const sessionId = ttySessionId(projectRoot, seat, agent);
      const inner = buildInteractiveInvocation(agent, { sessionId, model: opts.model, walled, seat });
      argv = wall ? [...wall.argvPrefix, ...inner] : inner;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let ptyLib: typeof import("@lydell/node-pty");
  try {
    ptyLib = await import("@lydell/node-pty");
  } catch (e) {
    return {
      ok: false,
      error:
        `the PTY backend is not installed (@lydell/node-pty) — run: cd ~/.crate/engine/core && npm install, ` +
        `then relaunch. (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 32;
  const startedAtMs = Date.now();
  // Union of both doors' stamps: seatEnv carries CRATE_SEAT (emit-identity —
  // a TTY session IS the seat's session) and CRATE_WALLED rides when the wall
  // is up (agent-browser shim keys --no-sandbox off it inside the wall).
  const env = {
    ...seatEnv(projectRoot, seat),
    TERM: "xterm-256color",
    ...(walled ? { CRATE_WALLED: "1" } : {}),
  } as Record<string, string>;
  if (blended && agent === "pi") {
    // Live probe (superman, 2026-08-12): pi's TUI crashes at import under the
    // system node v20; a blended pi seat must find node >= 22 first on PATH.
    const nodeBin = piNodeBinDir(opts.home ?? homedir());
    if (nodeBin) env.PATH = `${nodeBin}:${env.PATH ?? ""}`;
  }
  let proc: import("@lydell/node-pty").IPty;
  try {
    proc = ptyLib.spawn(argv[0]!, argv.slice(1), {
      name: "xterm-256color",
      cols,
      rows,
      cwd: projectRoot,
      env,
    });
  } catch (e) {
    return { ok: false, error: `could not open the ${agent} TUI: ${e instanceof Error ? e.message : String(e)}` };
  }

  const chunks: Buffer[] = [];
  let chunkBytes = 0;
  const subs = new Set<(ev: TtyEvent) => void>();
  const stamp = (line: string) => {
    try {
      appendFileSync(join(turnsDir(projectRoot, seat), "turns.log"), `${new Date().toISOString()} | ${line}\n`);
    } catch {
      /* the session matters more than the note */
    }
  };

  const tty: TtySeat = {
    seat,
    projectRoot,
    agent,
    startedAtMs,
    cols,
    rows,
    blended,
    composerDirty: false,
    write: (d) => {
      // The HUMAN chokepoint (cockpit xterm → /api/tty/input → here): stamp
      // the quiet-composer clock before the bytes reach the PTY.
      tty.lastHumanInputMs = Date.now();
      tty.composerDirty = updateComposerDirty(tty.composerDirty, d);
      try { proc.write(d.toString("utf8")); } catch { /* exited between checks */ }
    },
    inject: (d) => {
      // The ENGINE door: never stamps the human clock — a delivery must not
      // push its own quiet window away or read as a half-typed draft.
      try { proc.write(typeof d === "string" ? d : d.toString("utf8")); } catch { /* exited */ }
    },
    resize: (c, r) => {
      // Resize-storm guard (2026-08-12): the cockpit's 2s repaint re-fits
      // every seat; identical dims must never reach the TUI — a SIGWINCH
      // makes claude repaint its FULL transcript, and five seats doing that
      // flooded the cockpit link (~3 GB in 15 min over WiFi).
      if (c === tty.cols && r === tty.rows) return;
      tty.cols = c;
      tty.rows = r;
      try { proc.resize(c, r); } catch { /* exited */ }
    },
    kill: () => {
      try { proc.kill(); } catch { /* already gone */ }
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    replay: () => Buffer.concat(chunks),
  };

  proc.onData((d: string) => {
    const b = Buffer.from(d, "utf8");
    chunks.push(b);
    chunkBytes += b.length;
    while (chunkBytes > REPLAY_CAP && chunks.length > 1) {
      chunkBytes -= chunks[0]!.length;
      chunks.shift();
    }
    for (const cb of subs) cb({ data: b });
  });
  proc.onExit(({ exitCode }) => {
    tty.exited = { code: exitCode };
    if (blended) {
      // No hand-back seam: one door, nothing forked — the engine tracked the
      // session id continuously, so no re-point. The blend supervisor reads
      // this event (subscribe) and decides respawn; the stamp is the record.
      stamp(`blended ${agent} session exited (exit ${exitCode}) — the blend supervisor decides respawn`);
    } else {
      try { rmSync(attendedFile(projectRoot, seat)); } catch { /* stale-safe */ }
      const sid = repointSessionAfterTty(projectRoot, seat, agent, startedAtMs - 2000, opts.home);
      stamp(
        `operator left — native ${agent} TUI closed (exit ${exitCode}); deliveries resume` +
          (sid ? `; session re-pointed to ${sid.slice(0, 8)}… (the human-driven fork)` : ""),
      );
    }
    for (const cb of subs) cb({ exit: { code: exitCode } });
    // Guarded delete (blend relaunch lesson, live 2026-08-12): after an
    // evictSeatTty a SUCCESSOR pane may already own this key — a late exit
    // of the old process must never unregister the new session.
    if (registry.get(keyOf(projectRoot, seat)) === tty) registry.delete(keyOf(projectRoot, seat));
  });

  if (blended) {
    // A blended seat is NEVER held — a stale attended marker (crashed wheel
    // owner) would silently freeze its deliveries via runnerLoop's hold check.
    if (existsSync(attendedFile(projectRoot, seat))) {
      try {
        rmSync(attendedFile(projectRoot, seat));
        stamp(`stale attended marker cleared — blended seats are never held`);
      } catch { /* already gone */ }
    }
    stamp(`blended ${agent} session opened (engine-owned PTY; team mail is delivered into this live session)`);
  } else {
    // The hold + the honest record: the marker file is what the runner reads
    // (filesystem-visible across the server/runner process boundary).
    writeFileSync(attendedFile(projectRoot, seat), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    stamp(`operator attended — native ${agent} TUI open (the real ${agent}, inside the seat's wall); deliveries hold`);
  }

  registry.set(keyOf(projectRoot, seat), tty);
  return { ok: true, tty, reattached: false };
}

/** Close a seat's TTY (the UI's give-back-the-keys). No-op when none. */
export function stopSeatTty(projectRoot: string, seat: string): boolean {
  const t = liveTty(projectRoot, seat);
  if (!t) return false;
  t.kill();
  return true;
}

/**
 * Evict a seat's TTY NOW: kill it AND drop it from the registry immediately,
 * not on the async exit event. The blend relaunch lesson (live proof,
 * 2026-08-12): a D12 refresh stops the old supervisor and starts its
 * successor in the SAME tick — the successor's eager spawn found the dying
 * pane still registered, REATTACHED to it, and the promised visible fresh
 * pane only appeared at the next delivery. Eviction closes that window; the
 * old process still dies by kill(), and onExit's guarded delete keeps a late
 * exit from unregistering the successor.
 */
export function evictSeatTty(projectRoot: string, seat: string): boolean {
  const k = keyOf(projectRoot, seat);
  const t = registry.get(k);
  if (!t) return false;
  registry.delete(k);
  try {
    t.kill();
  } catch {
    /* already gone */
  }
  return true;
}
