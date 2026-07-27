// PHASE-8 T1 — turn composition + per-adapter headless invocation.
//
// The argv shapes and quirks are the T0 CONFIRM evidence, verbatim
// (dev/plan/proofs/phase-8/t0-adapter-confirms.md):
//   pi     -p --mode json [--session-id <uuid>]
//   claude -p --output-format stream-json --verbose [--resume <sid>]
//   codex  exec --json --dangerously-bypass-approvals-and-sandbox
//          (resume = `codex exec resume <thread>`; stdin MUST be closed or
//          exec hangs reading it; bypass is safe ONLY because the launcher
//          walls every codex seat — the P8 walling law holds headless)
// Composition is POINT-DON'T-PASTE (the boot-brief style): the seat has
// file tools and cwd = project root, so the prompt names the files to read
// instead of inlining them — this is what keeps per-turn re-orientation
// cheap (measured at the T1 gate).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "./mailbox.js";

export interface HeadlessInvocation {
  argv: string[];
  /** 'ignore' = spawn with stdin closed (the codex T0 quirk; harmless everywhere). */
  stdin: "ignore";
}

export function buildHeadlessInvocation(
  agent: string,
  opts: { prompt: string; sessionId?: string; model?: string; walled?: boolean },
): HeadlessInvocation {
  const { prompt, sessionId, model, walled } = opts;
  let argv: string[];
  switch (agent) {
    case "pi":
      argv = ["pi", "-p", "--mode", "json"];
      if (model) argv.push("--provider", model.split("/")[0]!, "--model", model.split("/").slice(1).join("/"));
      if (sessionId) argv.push("--session-id", sessionId);
      argv.push(prompt);
      break;
    case "claude":
      argv = ["claude", "-p", "--output-format", "stream-json", "--verbose"];
      // Unattended turns must not stall on tool prompts — but the bypass is
      // legal ONLY inside a rendered wall (P4-12; launcher parity: the walled
      // branch's full-auto posture). No wall → no flag → tools may refuse.
      if (walled) argv.push("--permission-mode", "bypassPermissions");
      if (model) argv.push("--model", model);
      if (sessionId) argv.push("--resume", sessionId);
      argv.push(prompt);
      break;
    case "codex":
      // The bypass folds approvals AND codex's own Seatbelt into one switch;
      // safe ONLY inside our wall (Seatbelt doesn't nest; the crate wall is the
      // containment). Gated on `walled` for the SAME defense-in-depth as claude
      // above: codex ∈ WALL_REQUIRED so a real turn is always walled, but if the
      // wall wiring ever regressed, an unwalled codex would merely prompt for
      // approvals rather than run fully bypassed AND uncontained.
      argv = sessionId
        ? ["codex", "exec", "resume", sessionId, "--json"]
        : ["codex", "exec", "--json"];
      if (walled) argv.push("--dangerously-bypass-approvals-and-sandbox");
      if (model) argv.push("--model", model);
      argv.push(prompt);
      break;
    // ── the 2026-07-14 seat expansion (Adam: agent-agnostic means OPTIONS) ──
    // Flag surfaces below were verified against the SHIPPING CLIs' --help the
    // night they were wired (npx opencode-ai / @google/gemini-cli; aider from
    // its stable documented automation flags). The catalog labels every one
    // "not yet battle-tested"; the first live turn is the remaining confirm.
    case "opencode":
      // opencode run: non-interactive by design; --format json = raw events;
      // -s resumes a session id (we parse it from the first turn's events).
      // --auto (auto-approve, flagged dangerous upstream) rides ONLY inside
      // a rendered wall — same defense-in-depth as claude/codex.
      argv = ["opencode", "run", "--format", "json"];
      if (walled) argv.push("--auto");
      if (model) argv.push("--model", model);
      if (sessionId) argv.push("--session", sessionId);
      argv.push(prompt);
      break;
    case "aider":
      // aider --message = one-shot headless; --yes-always is its documented
      // automation posture (aider edits repo files + commits — the seat's
      // job). Stateless v1: aider keeps its own chat history in-repo;
      // session resume is a follow-up once live-confirmed.
      argv = ["aider", "--message", prompt, "--yes-always", "--no-stream"];
      if (model) argv.push("--model", model);
      break;
    case "gemini":
      // gemini -p = documented headless mode; -o stream-json = parseable.
      // --approval-mode yolo ONLY inside a rendered wall (its own --sandbox
      // is Seatbelt and Seatbelt doesn't nest — never pass it under ours).
      // Stateless v1: --resume semantics (index vs id) confirm on first live
      // use before we wire sessions.
      argv = ["gemini", "-p", prompt, "-o", "stream-json"];
      if (walled) argv.push("--approval-mode", "yolo");
      if (model) argv.push("-m", model);
      break;
    default:
      throw new Error(
        `agent "${agent}" has no headless wire (pi/claude/codex are battle-tested; ` +
          `opencode/aider/gemini are wired, not yet battle-tested) — ` +
          `staffing refuses until a wire exists (D2).`,
      );
  }
  return { argv, stdin: "ignore" };
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Extract usage from ONE stream line (verbatim T0 shapes); undefined if not a usage line. */
export function parseUsage(agent: string, line: string): TurnUsage | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (agent === "pi") {
    const u = (d as { message?: { usage?: { input?: number; output?: number } } }).message?.usage;
    if (d.type === "message_end" && u) return { inputTokens: u.input ?? 0, outputTokens: u.output ?? 0 };
  }
  if (agent === "claude") {
    const u = (d as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (d.type === "result" && u) return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
  }
  if (agent === "codex") {
    const u = (d as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (d.type === "turn.completed" && u) return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
  }
  if (agent === "opencode") {
    // Defensive probe (event shape confirms on first live turn): message-info
    // events carry {tokens:{input,output}} under properties.info.
    const t = (d as { properties?: { info?: { tokens?: { input?: number; output?: number } } } }).properties?.info?.tokens;
    if (t && (t.input !== undefined || t.output !== undefined)) return { inputTokens: t.input ?? 0, outputTokens: t.output ?? 0 };
  }
  if (agent === "gemini") {
    // gemini -o stream-json: stats ride the result frame (shape confirms live).
    const u = (d as { stats?: { input_tokens?: number; output_tokens?: number } }).stats;
    if (u && (u.input_tokens !== undefined || u.output_tokens !== undefined)) {
      return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
    }
  }
  return undefined;
}

/** Extract the session/thread id from ONE stream line (T0 shapes). */
export function parseSessionId(agent: string, line: string): string | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (agent === "claude" && typeof d.session_id === "string") return d.session_id;
  if (agent === "codex" && d.type === "thread.started" && typeof d.thread_id === "string") return d.thread_id as string;
  if (agent === "opencode") {
    // Any event carrying a sessionID names the run's session (shapes vary by
    // event type — probe the two known homes, tolerant of either).
    const sid =
      (d as { sessionID?: string }).sessionID ??
      (d as { properties?: { info?: { sessionID?: string }; sessionID?: string } }).properties?.sessionID ??
      (d as { properties?: { info?: { sessionID?: string } } }).properties?.info?.sessionID;
    if (typeof sid === "string" && sid) return sid;
  }
  return undefined; // pi: the runner CHOOSES the id (--session-id), nothing to parse; aider/gemini: stateless v1
}

/**
 * Compose one turn's prompt: orientation pointers (read, don't paste) +
 * the unread mail + the non-negotiable reporting laws. Every turn carries
 * the freshness-law reminder — D12's refusal rail depends on state being
 * written before a session can be swapped.
 *
 * SPEED LAW (overnight 2026-07-14, from the testuser8 turn logs): a RESUMED
 * session already holds the binder + docs from its first turn, and re-reading
 * them cost every relay turn 3–5 tool round-trips — ~half the wall-clock of a
 * 25-token-output turn. `resumed: true` composes the SLIM prompt: mail + the
 * compact rails, orientation only by exception ("unsure → re-read"). The full
 * orientation rides the FIRST turn of every session, and again after a D12
 * context refresh (the session file is gone, so the turn is not resumed).
 */
export function composeTurnPrompt(
  projectRoot: string,
  seat: string,
  mail: Message[],
  opts: { resumed?: boolean } = {},
): string {
  const mailBlockSlim = mail.map((m) => `- [${m.at}] ${m.from}: ${m.body}`).join("\n");
  if (opts.resumed) {
    return `${seat} station, headless turn (resumed session — your binder, docs, and laws are already in your context; re-read .agents/config/${seat}.md ONLY if you are unsure of them).

Your inbox delivered:
${mailBlockSlim}

Act per your binder. Rails (unchanged): never send an ack-only reply — if a message needs no action, update state and end the turn silently; keep .agents/state/${seat}.md describing NOW; transitions via python3 .agents/bin/agentctl.py emit <verb> --actor ${seat}; results to peers via python3 .agents/bin/agentctl.py deliver <role> --from ${seat} "<message>".${
      seat === "orchestrator"
        ? ` Operator messages get a plain-words reply via deliver operator --from orchestrator. You coordinate — you never produce the work yourself.`
        : ""
    }
Your final text is a short plain-words turn summary.`;
  }
  const docs = ["AGENTS.md", "PROGRESS.md", "ISSUES.md"].filter((f) => existsSync(join(projectRoot, f)));
  const mailBlock = mailBlockSlim;
  return `You are the ${seat} station of this project's rig (headless turn). cwd is the project root.

Orient first — read in ONE pass:
  .agents/config/${seat}.md   (your role binder — your laws)
  ${docs.join("  ")}
  .agents/state/session.md and .agents/state/${seat}.md if present (live state)

Your inbox delivered:
${mailBlock}
${
    seat === "orchestrator"
      ? `
YOU ARE THE ORCHESTRATOR — YOU COORDINATE, YOU NEVER PRODUCE THE WORK YOURSELF (binder law).
When the operator asks for a feature, DO NOT write code, tests, designs, or reviews in this turn.
Instead run the loop by DELEGATING:
  1. Emit the phase start: python3 .agents/bin/agentctl.py emit start_impl --actor orchestrator branch=<feature/branch>
     (use start_design first if the task needs design; branch names the work).
  2. BRIEF THE CODER — this is what makes the coder actually build it:
       python3 .agents/bin/agentctl.py deliver coder --from orchestrator "Build <the feature> on branch <feature/branch>. <acceptance criteria>. Write the code + a test, run npm test, then emit code_ready."
  3. End your turn. The coder builds and its code_ready emit auto-wakes Review + QA in PARALLEL (you do not route them); you are woken at the JOIN — act once BOTH verdicts are in, then hold at the merge gate.
Do NOT edit src/, tests, or run the build in an orchestrator turn — delegate every bit of that.
`
      : ""
  }
Do the work your binder prescribes for these messages. Non-negotiable before you finish:
- NEVER send an acknowledgment-only reply. If a message needs no action (it's an ack, a "standing by", a "loop closed", a status with nothing to do), update your state if relevant and END your turn WITHOUT delivering anything. Replying to an ack creates an infinite message loop between seats.
- Update .agents/state/${seat}.md to describe NOW (freshness law: status/Now/concerns current; log section append-only).
- Emit any state-machine transitions via: python3 .agents/bin/agentctl.py emit <verb> --actor ${seat} ...
- Deliver results to a peer by appending to their inbox — ALWAYS sign it with --from ${seat}: python3 .agents/bin/agentctl.py deliver <role> --from ${seat} "<message>".${
    seat === "orchestrator"
      ? `\n- REPLY TO THE OPERATOR (this is a one-to-one chat): when a message is from "operator", answer them in plain words with:\n    python3 .agents/bin/agentctl.py deliver operator --from orchestrator "<your reply>"\n  That reply is what the human sees in the chat. Keep it conversational and brief.`
      : ""
  }
Your final text is a short plain-words turn summary (it lands in the turn log, not a chat).`;
}
