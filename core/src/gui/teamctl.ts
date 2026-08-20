// PHASE-8 T3 — the viewer's CONTROL surface (the first non-glass GUI layer):
// the orchestrator chat + the merge-gate cards. Both are thin front-ends
// over machinery that already exists — deliver (mailbox) and agentctl emit
// gate_release (the "merge go" physics). The state machine stays the truth;
// this module only reads it and asks the operator's authorizations of it.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localIsoOffset } from "../mailbox.js";
import { parseRigConf } from "../staffing.js";

function agentctl(projectRoot: string): string {
  return join(projectRoot, ".agents", "bin", "agentctl.py");
}

// One clock (Pack 5): every mirror line stamps localIsoOffset — the SAME
// shape agentctl's now() emits since the two-clocks fix, so merged chat
// threads sort correctly with zero TZ math for the operator.

/** 2d durable echo/ack (grilled 2026-07-25): append one line to a role's
 * inbox audit mirror WITHOUT waking any runner — the mirror is what the
 * chat thread renders, so a write here is durably in the thread. Newlines
 * are escaped so the line-oriented parser can never truncate a message.
 * agentctl's `[iso] (sender) text` format, verbatim. */
export function mirrorNote(projectRoot: string, role: string, sender: string, text: string): void {
  const inboxDir = join(projectRoot, ".agents", "state", "inbox");
  mkdirSync(inboxDir, { recursive: true });
  appendFileSync(join(inboxDir, `${role}.md`), `[${localIsoOffset()}] (${sender}) ${text.replaceAll("\n", "\\n")}\n`);
}

/** TS port of agentctl's operator_released(): True iff THIS task's gate is
 * armed (approved) and an operator GATE_RELEASE arrived after the arming,
 * unconsumed by a later deployed/reopen. Used by releaseGate to ABSORB a
 * repeat "merge go" instead of queueing a duplicate [MERGE] order. */
export function gateAlreadyReleased(projectRoot: string, task: string): boolean {
  const log = join(projectRoot, ".agents", "state", "events.log");
  if (!existsSync(log)) return false;
  const wanted = task && task !== "(single loop)" ? task : "";
  let armed = false;
  let released = false;
  for (const raw of readFileSync(log, "utf8").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const toks = raw.split(/\s+/);
    const evt = toks[1] ?? "";
    let rowTask: string | undefined;
    let actor = "";
    for (const t of toks) {
      if (t.startsWith("task=")) rowTask = t.slice(5);
      else if (t.startsWith("branch=") && rowTask === undefined) rowTask = t.slice(7);
      else if (t.startsWith("actor=")) actor = t.slice(6);
    }
    if (wanted && rowTask !== undefined && rowTask !== wanted) continue;
    if (evt === "GATE_RELEASE" && actor === "operator") {
      if (armed) released = true;
    } else if (evt === "APPROVED" || toks.includes("state=approved")) {
      armed = true;
      released = false; // a fresh approval needs a fresh release
    } else if (toks.includes("state=deployed") || toks.includes("state=implementing")) {
      armed = false;
      released = false; // merged or reopened
    }
  }
  return armed && released;
}

/** Current state per task (approved tasks are the pending merge gates).
 * Mirrors agentctl's fold: task= lines drive per-task, else the scalar. */
function taskStates(projectRoot: string): { scalar: string; tasks: Record<string, string> } {
  const log = join(projectRoot, ".agents", "state", "events.log");
  let scalar = "down";
  const tasks: Record<string, string> = {};
  if (!existsSync(log)) return { scalar, tasks };
  for (const raw of readFileSync(log, "utf8").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const toks = raw.split(/\s+/);
    let task: string | undefined;
    let st: string | undefined;
    for (const t of toks) {
      if (t.startsWith("task=")) task = t.slice(5);
      else if (t.startsWith("state=") && t.slice(6)) st = t.slice(6);
    }
    if (!st) continue;
    if (task) tasks[task] = st;
    else scalar = st;
  }
  return { scalar, tasks };
}

export interface GateCard {
  /** "merge" (default, awaiting "merge go") or "design" (CE-161: the
   * design-lock hold — the operator confirms or reopens the design). */
  kind?: "merge" | "design";
  task: string; // branch (or "(single loop)")
  branch: string;
  deploysTo: string;
  reviewOk: boolean;
  qaOk: boolean;
  /** Pack 4 (cockpit truth): released-but-unconsumed, from the EVENT record
   * (gateAlreadyReleased) — every surface renders release state from the log,
   * so a release honored elsewhere (pane phrase, another window, the CLI)
   * shows everywhere, not just in the releasing client's memory. */
  released: boolean;
}

/** Best-effort deploy target for the card (honest, never invented): rig.conf
 * DEPLOY_TARGET/PROD_URL, else the git remote host, else "main". */
function deployTarget(projectRoot: string, conf: Record<string, string>): string {
  if (conf.DEPLOY_TARGET) return conf.DEPLOY_TARGET;
  if (conf.PROD_URL) return conf.PROD_URL;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectRoot, encoding: "utf8" }).trim();
    const m = url.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]} (main)`;
  } catch { /* no remote */ }
  return "main";
}

/** TS twin of agentctl's join_verdicts() — Pack 4 (cockpit truth): the gate
 * lights read the SAME record the JOIN itself trusts. Verifier verdicts
 * recorded in events.log since this task's most recent CODE_READY (a fresh
 * sha voids all verdicts — the same freshness law as the pin); task
 * filtering mirrors gateAlreadyReleased. This REPLACED the prose regexes
 * over seat state files (verdicts()/qaGreen — deleted 2026-08-12): the
 * blended-era tester report format didn't match them, so QA showed "·" on
 * the gate card while QA had APPROVED on the record (ticket-#4), and before
 * that a partial-verification note read as green (W4 #3). Events, not prose. */
export function joinVerdicts(projectRoot: string, task: string): { reviewer?: string; tester?: string } {
  const log = join(projectRoot, ".agents", "state", "events.log");
  const v: { reviewer?: string; tester?: string } = {};
  if (!existsSync(log)) return v;
  const wanted = task && task !== "(single loop)" ? task : "";
  for (const raw of readFileSync(log, "utf8").split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const toks = raw.split(/\s+/);
    const evt = toks[1] ?? "";
    let rowTask: string | undefined;
    let actor = "";
    let result = "";
    for (const t of toks) {
      if (t.startsWith("task=")) rowTask = t.slice(5);
      else if (t.startsWith("branch=") && rowTask === undefined) rowTask = t.slice(7);
      else if (t.startsWith("actor=")) actor = t.slice(6);
      else if (t.startsWith("result=")) result = t.slice(7);
    }
    if (wanted && rowTask !== undefined && rowTask !== wanted) continue;
    if (evt === "CODE_READY") {
      delete v.reviewer;
      delete v.tester;
    } else if (evt === "VERDICT" && (actor === "reviewer" || actor === "tester")) {
      v[actor as "reviewer" | "tester"] = result;
    }
  }
  return v;
}

/** Tasks currently at `approved` = pending merge gates awaiting "merge go".
 * Lights are PER TASK from the event record (joinVerdicts) — green iff that
 * verifier's recorded result since the last code_ready is `approve`. */
export function pendingGates(projectRoot: string): GateCard[] {
  const conf = parseRigConf(readFileSync(join(projectRoot, ".agents", "rig.conf"), "utf8"));
  const { scalar, tasks } = taskStates(projectRoot);
  const dep = deployTarget(projectRoot, conf);
  const lights = (task: string): { reviewOk: boolean; qaOk: boolean } => {
    const v = joinVerdicts(projectRoot, task);
    return { reviewOk: v.reviewer === "approve", qaOk: v.tester === "approve" };
  };
  const cards: GateCard[] = [];
  const approved = Object.entries(tasks).filter(([, s]) => s === "approved");
  if (approved.length > 0) {
    for (const [task] of approved)
      cards.push({ task, branch: task, deploysTo: dep, ...lights(task), released: gateAlreadyReleased(projectRoot, task) });
  } else if (scalar === "approved") {
    let branch = "HEAD";
    try { branch = execFileSync("git", ["branch", "--show-current"], { cwd: projectRoot, encoding: "utf8" }).trim() || "HEAD"; } catch { /* */ }
    cards.push({ task: "(single loop)", branch, deploysTo: dep, ...lights("(single loop)"), released: gateAlreadyReleased(projectRoot, "(single loop)") });
  }
  // CE-161 (Phase C live loop, 2026-08-20): the design-lock hold is now a CARD
  // the ENGINE raises the moment the state lands — not a report the agent must
  // remember to send. The live loop parked at design_locked with chat empty
  // and gates empty; the operator experienced a stalled loop as a finished
  // one. The agent's narrative report remains the courtesy; this is the
  // guarantee. The branch comes from the DESIGN_LOCKED event itself.
  const designTasks = Object.entries(tasks).filter(([, st]) => st === "design_locked").map(([t]) => t);
  if (designTasks.length === 0 && scalar === "design_locked") designTasks.push("(single loop)");
  for (const t of designTasks) {
    let branch = t === "(single loop)" ? "" : t;
    try {
      const log = readFileSync(join(projectRoot, ".agents", "state", "events.log"), "utf8");
      const m = [...log.matchAll(/DESIGN_LOCKED[^\n]*?branch=(\S+)/g)].pop();
      if (m) branch = m[1]!;
    } catch { /* the card still stands without a branch name */ }
    cards.push({ kind: "design", task: t, branch: branch || "design", deploysTo: dep, reviewOk: false, qaOk: false, released: false });
  }
  return cards;
}

/** Pack 4 (cockpit truth): the pane-phrase fold. The operator's habit is
 * typing "merge go" INTO the orchestrator pane (both ticket-#4 gates) —
 * habit beats the surface, so the engine watches the ONE human chokepoint
 * (cockpit keyboard → POST /api/tty/input) and folds the typed bytes into
 * completed lines. CSI sequences are stripped (arrows are not typing),
 * Esc/Ctrl+C clear the draft, backspace pops, CR completes a line. The
 * buffer is capped — the phrase is short, and this is a phrase watcher,
 * never a keylogger. */
export function foldHumanLines(buf: string, data: Buffer): { buf: string; lines: string[] } {
  // CE-164 (Phase C's vanished release): a PASTED "merge go" was ERASED by its
  // own bracketed-paste terminator. xterm wraps pastes in ESC[200~ … ESC[201~;
  // the old strip turned every CSI into a bare ESC, and ESC means "clear the
  // draft" — so the terminator wiped the just-pasted phrase before Enter could
  // complete the line. The human's words were eaten by the machinery built to
  // honor them. Bracketed-paste markers are TRANSPARENT now (the content
  // between them IS the typing), and a chunk ending mid-escape is carried to
  // the next call instead of being half-matched (a split marker failed the
  // same way). Arrows and Escape still clear the draft — they are not typing.
  //
  // The draft may carry a pending partial escape at its end from the previous
  // call — recover it first (the draft itself never contains raw ESC: only
  // printable chars are ever appended below).
  let pend = "";
  const ei = buf.indexOf("\x1b");
  if (ei >= 0) { pend = buf.slice(ei); buf = buf.slice(0, ei); }
  let text = pend + data.toString("latin1");
  // hold back a trailing INCOMPLETE escape (bare ESC, or CSI without its final)
  let carry = "";
  const tail = /\x1b(\[[\x30-\x3f]*[\x20-\x2f]*)?$/.exec(text);
  if (tail) { carry = tail[0]; text = text.slice(0, text.length - carry.length); }
  text = text.replace(/\x1b\[20[01]~/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "\x1b");
  const lines: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d || c === 0x0a) {
      lines.push(buf);
      buf = "";
    } else if (c === 0x1b || c === 0x03) buf = "";
    else if (c === 0x7f || c === 0x08) buf = buf.slice(0, -1);
    else if (c >= 0x20) buf = (buf + text[i]).slice(-64);
  }
  buf = buf + carry;
  return { buf, lines };
}

/** Honor a pane-typed release: a completed line that IS the exact phrase,
 * while a gate is armed, releases through the SAME releaseGate the bar and
 * chat use (validation, durable echo, absorb-on-repeat included). The
 * keystrokes came through the cockpit's tokened human door — the OPERATOR's
 * keyboard — so the authority is the gate bar's, and the seat the pane
 * hosts never touches the emit. No gate armed / wrong phrase = nothing. */
export function honorPaneRelease(projectRoot: string, lines: string[]): { released?: string } {
  if (!lines.some((l) => l.trim().toLowerCase() === "merge go")) return {};
  const gate = pendingGates(projectRoot)[0];
  if (!gate) return {};
  const r = releaseGate(projectRoot, gate.task, "merge go");
  return r.ok ? { released: gate.task } : {};
}

/** The operator releases a gate by typing the phrase. Validates here AND lets
 * agentctl enforce it (defense in depth); returns the emit's output. */
export function releaseGate(projectRoot: string, task: string, phrase: string): { ok: boolean; out: string; absorbed?: boolean } {
  if (phrase.trim().toLowerCase() !== "merge go") {
    return { ok: false, out: 'the release phrase must be exactly "merge go".' };
  }
  const branchNote = task && task !== "(single loop)" ? ` ${task}` : " the approved branch";
  // 2d durable echo (grilled 2026-07-25): the operator's words land in the
  // thread's source of truth BEFORE anything else happens — a "merge go"
  // must never vanish, whatever the release path does next.
  mirrorNote(projectRoot, "orchestrator", "operator", phrase.trim());
  // 2d dedupe (absorb, don't duplicate): a gate that is already released
  // and unconsumed means a repeat "merge go" — emit nothing, mail nobody,
  // acknowledge honestly. First release wins.
  if (gateAlreadyReleased(projectRoot, task)) {
    mirrorNote(projectRoot, "operator", "engine", `Already released — the coder is merging${branchNote}; DEPLOYED will confirm.`);
    return { ok: true, out: "already released — repeat absorbed (no duplicate merge order)", absorbed: true };
  }
  const args = [agentctl(projectRoot), "emit", "gate_release", "--actor", "operator", "phrase=merge go"];
  if (task && task !== "(single loop)") args.push(`branch=${task}`);
  try {
    const out = execFileSync("python3", args, { cwd: projectRoot, encoding: "utf8" });
    // SPEED LAW (2026-07-14) + ONE ROUTE (2026-08-11): the go routes STRAIGHT
    // to the coder INSIDE the emit — agentctl's gate_release now queues the
    // [MERGE] mail itself (coder.md mirror + maildir wake), the identical
    // route every surface shares. The hand-rolled second deliver that used to
    // live here was exactly why "did the mechanical route act?" depended on
    // which surface the operator released from (FLAWS: [MERGE] routing is
    // nondeterministic across loops) — deleted, never re-add it. The
    // orchestrator learns via the mechanical [DEPLOYED] handoff and closes
    // the loop.
    // 2d mechanical ack (zero model turns — the speed-law mail doctrine):
    // an irreversible action gets an instant, honest, ENGINE-voiced receipt.
    mirrorNote(projectRoot, "operator", "engine", `Merge released — the coder is merging${branchNote}; DEPLOYED will confirm.`);
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

export interface ChatMessage {
  /** engine = the mechanical third voice (2d): acks written by code, never
   * attributed to the orchestrator — physics is not conversation. */
  from: "operator" | "orchestrator" | "engine";
  at: string;
  text: string;
}

/** The one-to-one thread: operator→orchestrator (the inbox audit mirror) +
 * orchestrator/engine→operator (the operator mailbox), merged in time
 * order. The chat IS the conversation, rendered from real artifacts. */
export function chatHistory(projectRoot: string, limit = 40): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  // Audit lines are `[iso] (sender) message`. The chat is ONLY the
  // operator↔orchestrator thread — inter-agent deliveries to the
  // orchestrator (coder/reviewer/QA verdicts) are filtered OUT by sender.
  // Escaped newlines are restored for display (2d multi-line fix); the
  // maildir-flavored `iso | from | body` mirror lines (mailbox.ts) parse too.
  const parse = (line: string): { at: string; sender: string; text: string } | undefined => {
    const m = line.match(/^\[([^\]]+)\]\s+\(([^)]+)\)\s+(.*)$/);
    if (m) return { at: m[1]!, sender: m[2]!, text: m[3]!.replaceAll("\\n", "\n") };
    const pipe = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+\|\s+([^|]+?)\s+\|\s(.*)$/);
    if (pipe) return { at: pipe[1]!, sender: pipe[2]!, text: pipe[3]!.replaceAll("\\n", "\n") };
    const legacy = line.match(/^\[([^\]]+)\]\s+(.*)$/); // pre-sender format
    if (legacy) return { at: legacy[1]!, sender: "operator", text: legacy[2]! };
    return undefined;
  };
  // operator → orchestrator: only messages whose sender is the operator, and
  // never an agent verdict (belt: a seat that forgets --from defaults to
  // "operator" — those start with a [VERDICT] tag and are not human chat).
  const isVerdict = (t: string): boolean => /^\[(PASS|FAIL|APPROVED|CHANGES_NEEDED|BLOCKER|DEPLOYED|MERGE)/i.test(t.trim());
  const inbound = join(projectRoot, ".agents", "state", "inbox", "orchestrator.md");
  if (existsSync(inbound)) {
    for (const line of readFileSync(inbound, "utf8").split("\n")) {
      const p = parse(line);
      if (p && p.sender === "operator" && !isVerdict(p.text)) msgs.push({ from: "operator", at: p.at, text: p.text });
    }
  }
  // orchestrator/engine → operator: the operator's mailbox. The sender tag
  // decides the voice — mechanical lines render as the engine, never as the
  // orchestrator speaking words it didn't say.
  const outbound = join(projectRoot, ".agents", "state", "inbox", "operator.md");
  if (existsSync(outbound)) {
    for (const line of readFileSync(outbound, "utf8").split("\n")) {
      const p = parse(line);
      if (p) msgs.push({ from: p.sender === "engine" ? "engine" : "orchestrator", at: p.at, text: p.text });
    }
  }
  msgs.sort((a, b) => a.at.localeCompare(b.at));
  return msgs.slice(-limit);
}

export interface Preview {
  url: string;
  route: string;
  label: string;
  from: string;
  at: string;
}

/** Design Studio slot state (backlog 10, PDR dev/pdr/design-studio.md) —
 * DERIVED, never reported: the slot is occupied iff a registered preview
 * exists (preview.json is written/cleared by agentctl on the design task's
 * own transitions — ticket CLOSE clears it through the same door, proven
 * live on #7). One slot: the NEWEST registration holds it (#7's live round
 * showed designers APPEND a registration per revision — oldest-first served
 * a stale label all round, and a revision that moved ports would have
 * pinned the glass to the dead one). The two
 * waiting truths read differently on the glass: a free slot ("awaiting the
 * next design task" — which is also the honest post-lock state) vs a dead
 * server behind an occupied slot ("the preview server went down"). */
export type StudioState =
  | { mode: "waiting"; reason: string }
  | { mode: "live"; url: string; route: string; label: string; from: string; at: string; key: string; proxyPort?: number };

export function deriveStudioState(previews: Preview[], probeOk: boolean, proxyPort?: number): StudioState {
  const p = previews[previews.length - 1];
  if (!p) return { mode: "waiting", reason: "awaiting the next design task" };
  if (!probeOk) return { mode: "waiting", reason: "the preview server went down" };
  return {
    mode: "live",
    url: p.url,
    route: p.route || "/",
    label: p.label || p.route || p.url,
    from: p.from,
    at: p.at,
    key: `${p.url}|${p.route || "/"}`,
    // http targets render through the engine's proxy (the glass never holds
    // a raw dev URL — the routing law); anything else passes through as-is
    ...(p.url.startsWith("http://") && proxyPort ? { proxyPort } : {}),
  };
}

/** PHASE-8 T5: pending previews (pages flagged for the human's eyes). */
export function pendingPreviews(projectRoot: string): Preview[] {
  const f = join(projectRoot, ".agents", "state", "preview.json");
  if (!existsSync(f)) return [];
  try {
    const items = JSON.parse(readFileSync(f, "utf8")) as Preview[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** The human's verdict on a preview: clear it, and (if changes) tell the
 * orchestrator. approve=true is the design-lock confirm. */
export function resolvePreview(projectRoot: string, approve: boolean, note?: string): { ok: boolean } {
  const agentctlPath = join(projectRoot, ".agents", "bin", "agentctl.py");
  try {
    execFileSync("python3", [agentctlPath, "preview", "clear"], { cwd: projectRoot });
    const msg = approve
      ? "The operator reviewed the preview and it looks good — proceed."
      : `The operator wants changes to the preview: ${note ?? "(see notes)"}`;
    execFileSync("python3", [agentctlPath, "deliver", "orchestrator", "--from", "operator", msg], { cwd: projectRoot });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Operator sends a message to the orchestrator (deliver → its mailbox). */
export function sendToOrchestrator(projectRoot: string, text: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("python3", [agentctl(projectRoot), "deliver", "orchestrator", "--from", "operator", text], {
      cwd: projectRoot, encoding: "utf8",
    });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}
