// PHASE-8 T2 — the thin viewer's data layer: read the headless artifacts a
// runner produces (turn logs, session, mailbox, state files) into a shape
// the /team page renders. READ-ONLY (the viewer is glass, never a control
// surface at T2). Two lenses come from ONE capture: the raw jsonl stream
// (Engineer) and a narrated digest derived from it (Narrated).
import { resolveSeatStaffing } from "../launcher.js";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { blendEligible, isBlended, sessionUsage, type BlendCli } from "../blend.js";
import { claudeProjectDir, liveTty } from "../ptyseat.js";
import { isAttended, sessionFile } from "../runner.js";
import { parseRigConf, RIG_PREFIX } from "../staffing.js";
import { SEATS } from "../manifest.js";
import { gaugeFrom, type ContextGauge } from "./context.js";

export interface TurnEvent {
  /** Narrated one-liner ("editing slugify.js", "tests: 214 passed"). */
  narrated: string;
  /** Plain-English version for the Narrated lens (non-coder friendly);
   * falls back to `narrated` when there's nothing to simplify. */
  plain?: string;
  /** Raw jsonl line. narrateLine always sets it; readTeamView STRIPS it
   * from the wire (stage 2, quiet-cockpit PDR): nothing renders it, and it
   * multiplied the poll payload — ~25 full transcripts re-shipped every
   * tick carried every original line for nobody. */
  raw?: string;
  kind: "tool" | "text" | "result" | "system" | "stderr" | "meta" | "think" | "other";
}

/** Turn a technical tool action into plain English for non-coders. */
function plainTool(name: string, arg: string): string {
  const a = arg.toLowerCase();
  if (name === "read") return "Reading the project files";
  if (name === "write") return "Writing up its notes";
  if (name === "edit") return "Editing the code";
  if (name === "bash" || name === "$") {
    if (/\bnpm test\b|node test|jest|vitest|pytest|\btest\.js/.test(a)) return "Running the tests";
    if (/git commit/.test(a)) return "Saving the changes";
    if (/git push/.test(a)) return "Publishing the work";
    if (/git (diff|show|log|status)/.test(a)) return "Reviewing what changed";
    if (/nm-gate|quality|lint|typecheck|build/.test(a)) return "Running the quality checks";
    if (/agentctl\s+deliver/.test(a)) return "Messaging a teammate";
    if (/agentctl\s+(emit|state|check)/.test(a)) return "Updating its status";
    if (/\b(find|ls|cat|grep|rg|head|tail)\b/.test(a)) return "Looking around the project";
    return "Running a command";
  }
  return "Working";
}

export interface TurnView {
  file: string;
  startedAt: string;
  /** epoch ms of turn start (for the live elapsed readout). */
  startedAtMs?: number;
  ok: boolean | null; // null = still running (no meta line yet)
  durationMs?: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** running token total seen so far (for the live readout). */
  liveTokens?: number;
  events: TurnEvent[];
  /** Terse narrated ticker (Adam's T2 ask): tool/result beats + the ONE
   * final conclusion line, deduped — not pi's full prose. */
  digest: string[];
  /** LIVE motion (Adam's T3 ask): the recent stream — tool calls +
   * thinking — so a running turn visibly WORKS in Narrated view, not a
   * dead pane. Collapses to the digest once the turn completes. */
  live: string[];
}

/** The recent stream for a running turn: meaningful beats (tool calls,
 * thinking) as a short tail, so the user SEES the agent working. */
export function liveTail(events: TurnEvent[], n = 8): string[] {
  // real actions only — no "thinking…" spam (the header racing spinner IS
  // the working indicator; the feed shows what the agent actually DID).
  const out: string[] = [];
  for (const e of events) {
    if (e.kind !== "tool" && e.kind !== "result" && e.kind !== "stderr") continue;
    const line = firstClause(e.kind === "tool" ? (e.plain ?? e.narrated) : e.narrated);
    if (line && out[out.length - 1] !== line) out.push(line);
  }
  return out.slice(-n);
}

/** Collapse a turn's events into a terse ticker. Rules: keep tool + result +
 * stderr beats (the "what happened"), keep only the LAST text event (the
 * conclusion, trimmed to one clause), drop system/chatter, dedupe repeats. */
export function narratedDigest(events: TurnEvent[]): string[] {
  const tools: string[] = [];
  let lastText: string | undefined;
  for (const e of events) {
    if (e.kind === "text") { lastText = e.narrated; continue; }
    if (e.kind === "tool" || e.kind === "result" || e.kind === "stderr") {
      // plain English for tools (non-coder Narrated view); prose kept as-is
      const line = firstClause(e.kind === "tool" ? (e.plain ?? e.narrated) : e.narrated);
      if (line && tools[tools.length - 1] !== line) tools.push(line);
    }
  }
  // keep a tidy trace (the last few actions) + the conclusion — enough to
  // show what happened without dumping every read.
  const out = tools.slice(-6);
  if (lastText) {
    const concl = firstClause(lastText);
    if (concl && out[out.length - 1] !== concl) out.push(concl);
  }
  return out;
}

/** First sentence, capped — a ticker line, not a paragraph. Keeps a
 * "label: VERDICT" intact (the verdict is the point); breaks on sentence
 * ends and em-dashes only. */
function firstClause(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  const cut = trimmed.split(/(?<=[.!])\s|\s[—–]\s/)[0] ?? trimmed;
  return cut.length > 110 ? cut.slice(0, 107) + "…" : cut;
}

export interface SeatView {
  seat: string;
  title: string;
  agent: string;
  model?: string;
  /** newest turn first */
  turns: TurnView[];
  /** freshest state/<seat>.md status line, if any */
  status?: string;
  lastActivity?: string;
  /** D12 context fullness gauge (undefined until the seat has run a turn). */
  gauge?: ContextGauge;
  /** unread mail waiting in the seat's inbox (the hold-blocked queue). */
  unread: number;
  /** a human holds this seat's wheel — deliveries are paused. */
  attended: boolean;
  /** Blended pane (PDR S2): this seat is flagged BLEND_<PREFIX>=1 with an
   * eligible agent — the pane IS its live session; no wheel, no hold. */
  blended?: boolean;
  /** blended only: the live session file grew in the last few seconds. */
  responding?: boolean;
  /** blended only: ISO of the session file's last growth (the idle chip). */
  lastOutputAt?: string;
  /** blended only: the live PTY's spawn epoch — the client reopens its
   * multiplexed stream when this changes (a respawn is a NEW PTY the
   * connect-time-enumerated SSE does not carry). */
  ptyStartedAt?: number;
}

export interface TeamView {
  project: string;
  seats: SeatView[];
}

/** Best-effort narration of one raw stream line — adapter-shape-aware but
 * defensive (unknown lines degrade to a short raw echo, never throw). */
export function narrateLine(raw: string): TurnEvent {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { narrated: raw.slice(0, 120), raw, kind: "other" };
  }
  const type = String(d.type ?? "");
  // pi live stream: tool calls + thinking deltas = the visible "working" motion
  if (type === "tool_execution_start") {
    const name = String(d.toolName ?? "tool");
    const a = (d.args ?? {}) as { path?: string; command?: string; file_path?: string; pattern?: string };
    const arg = a.command ? a.command : (a.path ?? a.file_path ?? a.pattern ?? "");
    const short = arg.length > 60 ? "…" + arg.slice(-57) : arg;
    const verb = name === "bash" ? "$" : name;
    return { narrated: `${verb} ${short}`.trim(), plain: plainTool(name, arg), raw, kind: "tool" };
  }
  if (type === "tool_execution_end") return { narrated: "· done", raw, kind: "other" };
  if (type === "message_update") {
    const ev = (d.assistantMessageEvent ?? {}) as { type?: string };
    if (String(ev.type ?? "").includes("thinking")) return { narrated: "thinking…", raw, kind: "think" };
    return { narrated: "…", raw, kind: "other" };
  }
  if (d.turnMeta) {
    const u = d.usage as { inputTokens?: number; outputTokens?: number } | null;
    return { narrated: `turn ${d.ok ? "complete" : "FAILED"} · ${d.durationMs}ms · ${u ? `${u.inputTokens}→${u.outputTokens} tok` : "—"}`, raw, kind: "meta" };
  }
  if (d.stderr) return { narrated: `⚠ ${String(d.stderr).trim().slice(0, 100)}`, raw, kind: "stderr" };
  // claude stream-json
  if (type === "system") return { narrated: `· session ${String((d as { subtype?: string }).subtype ?? "event")}`, raw, kind: "system" };
  if (type === "assistant" || type === "text" || type === "message_end" || type === "turn_end") {
    const text = extractText(d);
    if (text) return { narrated: text.slice(0, 140), raw, kind: "text" };
  }
  if (type === "result") return { narrated: `✓ ${String((d as { result?: string }).result ?? "done").slice(0, 140)}`, raw, kind: "result" };
  // codex exec
  if (type === "item.completed") {
    const item = (d as { item?: { type?: string; text?: string } }).item;
    if (item?.type === "agent_message" && item.text) return { narrated: item.text.slice(0, 140), raw, kind: "text" };
    if (item?.type?.includes("command")) return { narrated: `$ ${(item as { command?: string }).command ?? item.type}`.slice(0, 140), raw, kind: "tool" };
    return { narrated: `· ${item?.type ?? "item"}`, raw, kind: "other" };
  }
  if (type === "turn.completed") return { narrated: "· turn complete", raw, kind: "other" };
  if (type === "thread.started" || type === "turn.started") return { narrated: `· ${type}`, raw, kind: "system" };
  return { narrated: `· ${type || "event"}`, raw, kind: "other" };
}

// ── 2c LIVE seat readout — the stream render policy (ONE policy, grilled
// 2026-07-25): agent text renders in FULL as it streams; every tool call is
// a one-line beat (tech flavor for Engineer, plain for Narrated); tool
// OUTPUT bodies never render — an honest fold line only, EXCEPT a failed
// call, which shows its last error lines. Thinking renders as its one-line
// block summary (thinking_end), never the delta spam. The black box on disk
// stays lossless; all of this is read-time. ──

export interface StreamEvent {
  /** seam=turn boundary · td=text delta · text=final text · think=thought
   * summary · tool=call beat · fold=output size note · errtail=failed-call
   * evidence · stderr=harness stderr · meta=turn end line · poke=project
   * STATE changed (gates/chat/seat files — stage 2 event-primary): the
   * client schedules a throttled refresh; carries no data of its own */
  k: "seam" | "td" | "text" | "think" | "tool" | "fold" | "errtail" | "stderr" | "meta" | "poke";
  t: string;
  /** plain-English flavor (tool beats only — the Narrated lens). */
  p?: string;
  /** meta only: did the turn succeed. */
  ok?: boolean;
}

/** How many output lines a successful tool call may have before the pane
 * says so (silence on success below it — a fold line would just be noise). */
const FOLD_MIN_LINES = 5;

function toolResultText(d: Record<string, unknown>): string {
  const r = (d as { result?: { content?: Array<{ type?: string; text?: string }> } }).result;
  if (!r?.content) return "";
  return r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

/** Map one raw stream line to at most one live-feed event, per the locked
 * render policy. Returns undefined for lines the pane drops (toolcall arg
 * deltas, lifecycle chatter, successful small outputs). Defensive: an
 * unknown or unparseable line is dropped, never thrown on. */
export function streamEvent(raw: string): StreamEvent | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const type = String(d.type ?? "");
  if (type === "message_update") {
    const ev = (d.assistantMessageEvent ?? {}) as { type?: string; delta?: string; content?: string };
    if (ev.type === "text_delta" && ev.delta) return { k: "td", t: ev.delta };
    if (ev.type === "text_end" && ev.content) return { k: "text", t: ev.content };
    if (ev.type === "thinking_end") {
      const t = String(ev.content ?? "").replaceAll("**", "").trim();
      return t ? { k: "think", t } : undefined;
    }
    return undefined; // toolcall_* deltas + starts = the recorded noise the pane drops
  }
  if (type === "tool_execution_start") {
    const name = String(d.toolName ?? "tool");
    const a = (d.args ?? {}) as { path?: string; command?: string; file_path?: string; pattern?: string };
    const arg = a.command ? a.command : (a.path ?? a.file_path ?? a.pattern ?? "");
    const short = arg.length > 90 ? "…" + arg.slice(-87) : arg;
    const verb = name === "bash" ? "$" : name;
    return { k: "tool", t: `${verb} ${short}`.trim(), p: plainTool(name, arg) };
  }
  if (type === "tool_execution_end") {
    const isError = Boolean((d as { result?: { isError?: boolean } }).result?.isError);
    const out = toolResultText(d);
    const lines = out ? out.split("\n") : [];
    if (isError) {
      const tail = lines.filter((l) => l.trim()).slice(-4).map((l) => (l.length > 200 ? l.slice(0, 197) + "…" : l));
      return { k: "errtail", t: tail.length ? tail.join("\n") : "tool call failed" };
    }
    if (lines.length >= FOLD_MIN_LINES) return { k: "fold", t: `… ${lines.length.toLocaleString()} lines of output` };
    return undefined; // silence on success
  }
  if (d.turnMeta) {
    const u = d.usage as { inputTokens?: number; outputTokens?: number } | null;
    return {
      k: "meta",
      t: `turn ${d.ok ? "complete" : "FAILED"} · ${d.durationMs}ms · ${u ? `${u.inputTokens}→${u.outputTokens} tok` : "—"}`,
      ok: Boolean(d.ok),
    };
  }
  if (d.stderr) return { k: "stderr", t: `⚠ ${String(d.stderr).trim().slice(0, 200)}` };
  // claude stream-json: assistant messages carry the text (role-checked so a
  // replayed USER prompt never renders as agent speech)
  if (type === "assistant") {
    const role = (d as { message?: { role?: string } }).message?.role;
    if (role && role !== "assistant") return undefined;
    const text = extractText(d);
    return text ? { k: "text", t: text } : undefined;
  }
  // codex exec
  if (type === "item.completed") {
    const item = (d as { item?: { type?: string; text?: string; command?: string } }).item;
    if (item?.type === "agent_message" && item.text) return { k: "text", t: item.text };
    if (item?.type?.includes("command")) return { k: "tool", t: `$ ${item.command ?? item.type}`, p: plainTool("bash", item.command ?? "") };
    return undefined;
  }
  return undefined; // lifecycle chatter (session, turn_start, message_*, agent_*)
}

/** Reconstruct epoch ms from a turn file's name — shared with the tailer's
 * seam events (the filename IS the turn id). */
export function turnStartMs(name: string): number | undefined {
  return startedMsFromName(name);
}

function extractText(d: Record<string, unknown>): string | undefined {
  const msg = (d as { message?: { content?: Array<{ type?: string; text?: string }> } }).message;
  if (msg?.content) return msg.content.filter((c) => c.type === "text").map((c) => c.text).join(" ").trim() || undefined;
  if (typeof (d as { text?: string }).text === "string") return (d as { text: string }).text;
  return undefined;
}

/** Reconstruct epoch ms from a turn file's ISO name (colons became dashes). */
function startedMsFromName(name: string): number | undefined {
  const iso = name.replace(".jsonl", "").replace(/T(\d\d)-(\d\d)-(\d\d)/, "T$1:$2:$3");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Latest running token total seen in the stream (pi message usage totals). */
function runningTokens(parsed: Record<string, unknown>[]): number | undefined {
  let tok: number | undefined;
  for (const d of parsed) {
    const u = (d as { message?: { usage?: { totalTokens?: number } }; usage?: { totalTokens?: number } });
    const t = u.message?.usage?.totalTokens ?? u.usage?.totalTokens;
    if (typeof t === "number" && t > 0) tok = t;
  }
  return tok;
}

function readTurn(path: string): TurnView {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  // raw stays narrateLine's contract but never rides the view (see TurnEvent.raw)
  const events = lines.map((l) => {
    const { raw: _omit, ...e } = narrateLine(l);
    return e;
  });
  const parsed = lines.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; } });
  const meta = parsed.find((d) => d.turnMeta);
  const name = path.split("/").pop()!;
  const startedAtMs = (meta?.startedAt ? Date.parse(meta.startedAt as string) : undefined) ?? startedMsFromName(name);
  const lt = runningTokens(parsed);
  return {
    file: name,
    startedAt: (meta?.startedAt as string) ?? name.replace(".jsonl", ""),
    ...(startedAtMs !== undefined && !Number.isNaN(startedAtMs) ? { startedAtMs } : {}),
    ok: meta ? Boolean(meta.ok) : null,
    ...(meta?.durationMs ? { durationMs: meta.durationMs as number } : {}),
    ...(meta?.usage ? { usage: meta.usage as TurnView["usage"] } : {}),
    ...(lt !== undefined ? { liveTokens: lt } : {}),
    events,
    digest: narratedDigest(events),
    live: liveTail(events),
  };
}

/** A blended seat's live-session lens: gauge + responding + last output,
 * read from the session file the delivery loop verified against (there are
 * NO headless turn files to read). Claude's path is exactly derivable from
 * the persisted sessionFile; pi/codex gauges degrade honestly to none here
 * (the pane still shows the live TUI) until their discovery is wired in.
 * Everything is best-effort — a missing/foreign session file yields {}. */
function blendedSeatView(
  projectRoot: string,
  seat: string,
  cli: BlendCli | undefined,
  model: string | undefined,
  home: string,
): { gauge?: ContextGauge; responding?: boolean; lastOutputAt?: string } {
  if (cli !== "claude") return {};
  try {
    const j = JSON.parse(readFileSync(sessionFile(projectRoot, seat), "utf8")) as { agent?: string; sessionId?: string };
    if (j.agent !== "claude" || !j.sessionId) return {};
    let root = projectRoot;
    try {
      root = realpathSync(projectRoot);
    } catch {
      /* keep as given */
    }
    const p = join(claudeProjectDir(root, home), `${j.sessionId}.jsonl`);
    const mtimeMs = statSync(p).mtimeMs;
    const usage = sessionUsage(readFileSync(p, "utf8"));
    const gauge = gaugeFrom(usage?.inputTokens, model); // absent usage → no gauge, never a fake 0%
    return {
      ...(gauge ? { gauge } : {}),
      responding: Date.now() - mtimeMs < 3000,
      lastOutputAt: new Date(mtimeMs).toISOString(),
    };
  } catch {
    return {};
  }
}

function stateStatus(projectRoot: string, seat: string): { status?: string; when?: string } {
  const f = join(projectRoot, ".agents", "state", `${seat}.md`);
  if (!existsSync(f)) return {};
  const text = readFileSync(f, "utf8");
  const status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim();
  const now = text.match(/^Now:\s*(.+)$/m)?.[1]?.trim();
  return { ...(status ? { status } : {}), ...(now ? { when: now } : {}) };
}

export function readTeamView(projectRoot: string, maxTurnsPerSeat = 5, home: string = homedir()): TeamView {
  const confFile = join(projectRoot, ".agents", "rig.conf");
  const conf = existsSync(confFile) ? parseRigConf(readFileSync(confFile, "utf8")) : {};
  const titles: Record<string, string> = {
    orchestrator: conf.ORCH_TITLE || "Orchestrator", coder: conf.CODER_TITLE || "Coder",
    reviewer: conf.REVIEWER_TITLE || "Reviewer", designer: conf.DESIGNER_TITLE || "Designer",
    tester: conf.TESTER_TITLE || "QA",
  };
  const seats: SeatView[] = SEATS.map((seat) => {
    const dir = join(projectRoot, ".agents", "state", "turns", seat);
    const turnFiles = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse().slice(0, maxTurnsPerSeat)
      : [];
    const turns = turnFiles.map((f) => readTurn(join(dir, f)));
    const st = stateStatus(projectRoot, seat);
    const agentKey = `${RIG_PREFIX[seat]}_AGENT`; // rig.conf keys use ORCH, not ORCHESTRATOR
    // CE-141: the seat card must name the agent the seat ACTUALLY runs — the
    // canonical chain, not rig.conf alone (which showed a phantom pi).
    // The chain THROWS on a malformed defaults.yaml (staffing the wrong agent
    // silently is worse than refusing) — correct at boot, wrong here: the
    // cockpit must still render. Degrade to conf-only for the CARD.
    let staffed: { agent: string; model?: string };
    try {
      staffed = resolveSeatStaffing(projectRoot, seat, home, conf);
    } catch {
      staffed = resolveSeatStaffing(projectRoot, seat, undefined, conf);
    }
    const model = staffed.model;
    // context fullness from the newest turn that reported input tokens (the
    // session's current context size), or the live running total as fallback.
    const withUsage = turns.find((t) => t.usage?.inputTokens);
    const ctxTokens = withUsage?.usage?.inputTokens ?? turns.find((t) => t.liveTokens)?.liveTokens;
    const gauge = gaugeFrom(ctxTokens, model);
    // The wheel-as-viewer trap (FLAWS 2026-08-11): a held wheel silently
    // parks the seat. The view now carries the truth — attended + how much
    // mail waits behind the hold — so the pane can SAY it.
    let unread = 0;
    try {
      unread = readdirSync(join(projectRoot, ".agents", "state", "inbox", seat, "new")).filter((f) => f.endsWith(".msg")).length;
    } catch {
      /* no inbox yet */
    }
    const attended = isAttended(projectRoot, seat);
    // S4: blend is the default — eligible + not opted out = the pane is a
    // live session; an ineligible agent fell back to headless at boot, and
    // the page must not render a phantom pane.
    const agentRaw = staffed.agent;
    const el = blendEligible(agentRaw);
    const blended = isBlended(conf, seat, agentRaw);
    const bv = blended ? blendedSeatView(projectRoot, seat, el.ok ? el.cli : undefined, model, home) : {};
    const pty = blended ? liveTty(projectRoot, seat) : undefined;
    return {
      seat, title: titles[seat]!, agent: agentRaw,
      ...(model ? { model } : {}),
      unread,
      attended,
      ...(blended
        ? {
            blended: true,
            responding: bv.responding ?? false,
            ...(bv.lastOutputAt ? { lastOutputAt: bv.lastOutputAt } : {}),
            ...(pty ? { ptyStartedAt: pty.startedAtMs } : {}),
          }
        : {}),
      turns,
      ...(st.status ? { status: st.status } : {}),
      ...(st.when ? { lastActivity: st.when } : {}),
      ...(blended ? (bv.gauge ? { gauge: bv.gauge } : {}) : gauge ? { gauge } : {}),
    };
  });
  return { project: conf.PROJECT || projectRoot.split("/").pop()!, seats };
}
