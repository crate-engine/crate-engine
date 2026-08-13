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
function agentctl(projectRoot) {
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
export function mirrorNote(projectRoot, role, sender, text) {
    const inboxDir = join(projectRoot, ".agents", "state", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    appendFileSync(join(inboxDir, `${role}.md`), `[${localIsoOffset()}] (${sender}) ${text.replaceAll("\n", "\\n")}\n`);
}
/** TS port of agentctl's operator_released(): True iff THIS task's gate is
 * armed (approved) and an operator GATE_RELEASE arrived after the arming,
 * unconsumed by a later deployed/reopen. Used by releaseGate to ABSORB a
 * repeat "merge go" instead of queueing a duplicate [MERGE] order. */
export function gateAlreadyReleased(projectRoot, task) {
    const log = join(projectRoot, ".agents", "state", "events.log");
    if (!existsSync(log))
        return false;
    const wanted = task && task !== "(single loop)" ? task : "";
    let armed = false;
    let released = false;
    for (const raw of readFileSync(log, "utf8").split("\n")) {
        if (!raw.trim() || raw.trimStart().startsWith("#"))
            continue;
        const toks = raw.split(/\s+/);
        const evt = toks[1] ?? "";
        let rowTask;
        let actor = "";
        for (const t of toks) {
            if (t.startsWith("task="))
                rowTask = t.slice(5);
            else if (t.startsWith("branch=") && rowTask === undefined)
                rowTask = t.slice(7);
            else if (t.startsWith("actor="))
                actor = t.slice(6);
        }
        if (wanted && rowTask !== undefined && rowTask !== wanted)
            continue;
        if (evt === "GATE_RELEASE" && actor === "operator") {
            if (armed)
                released = true;
        }
        else if (evt === "APPROVED" || toks.includes("state=approved")) {
            armed = true;
            released = false; // a fresh approval needs a fresh release
        }
        else if (toks.includes("state=deployed") || toks.includes("state=implementing")) {
            armed = false;
            released = false; // merged or reopened
        }
    }
    return armed && released;
}
/** Current state per task (approved tasks are the pending merge gates).
 * Mirrors agentctl's fold: task= lines drive per-task, else the scalar. */
function taskStates(projectRoot) {
    const log = join(projectRoot, ".agents", "state", "events.log");
    let scalar = "down";
    const tasks = {};
    if (!existsSync(log))
        return { scalar, tasks };
    for (const raw of readFileSync(log, "utf8").split("\n")) {
        if (!raw.trim() || raw.trimStart().startsWith("#"))
            continue;
        const toks = raw.split(/\s+/);
        let task;
        let st;
        for (const t of toks) {
            if (t.startsWith("task="))
                task = t.slice(5);
            else if (t.startsWith("state=") && t.slice(6))
                st = t.slice(6);
        }
        if (!st)
            continue;
        if (task)
            tasks[task] = st;
        else
            scalar = st;
    }
    return { scalar, tasks };
}
/** Best-effort deploy target for the card (honest, never invented): rig.conf
 * DEPLOY_TARGET/PROD_URL, else the git remote host, else "main". */
function deployTarget(projectRoot, conf) {
    if (conf.DEPLOY_TARGET)
        return conf.DEPLOY_TARGET;
    if (conf.PROD_URL)
        return conf.PROD_URL;
    try {
        const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectRoot, encoding: "utf8" }).trim();
        const m = url.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (m)
            return `${m[1]} (main)`;
    }
    catch { /* no remote */ }
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
export function joinVerdicts(projectRoot, task) {
    const log = join(projectRoot, ".agents", "state", "events.log");
    const v = {};
    if (!existsSync(log))
        return v;
    const wanted = task && task !== "(single loop)" ? task : "";
    for (const raw of readFileSync(log, "utf8").split("\n")) {
        if (!raw.trim() || raw.trimStart().startsWith("#"))
            continue;
        const toks = raw.split(/\s+/);
        const evt = toks[1] ?? "";
        let rowTask;
        let actor = "";
        let result = "";
        for (const t of toks) {
            if (t.startsWith("task="))
                rowTask = t.slice(5);
            else if (t.startsWith("branch=") && rowTask === undefined)
                rowTask = t.slice(7);
            else if (t.startsWith("actor="))
                actor = t.slice(6);
            else if (t.startsWith("result="))
                result = t.slice(7);
        }
        if (wanted && rowTask !== undefined && rowTask !== wanted)
            continue;
        if (evt === "CODE_READY") {
            delete v.reviewer;
            delete v.tester;
        }
        else if (evt === "VERDICT" && (actor === "reviewer" || actor === "tester")) {
            v[actor] = result;
        }
    }
    return v;
}
/** Tasks currently at `approved` = pending merge gates awaiting "merge go".
 * Lights are PER TASK from the event record (joinVerdicts) — green iff that
 * verifier's recorded result since the last code_ready is `approve`. */
export function pendingGates(projectRoot) {
    const conf = parseRigConf(readFileSync(join(projectRoot, ".agents", "rig.conf"), "utf8"));
    const { scalar, tasks } = taskStates(projectRoot);
    const dep = deployTarget(projectRoot, conf);
    const lights = (task) => {
        const v = joinVerdicts(projectRoot, task);
        return { reviewOk: v.reviewer === "approve", qaOk: v.tester === "approve" };
    };
    const cards = [];
    const approved = Object.entries(tasks).filter(([, s]) => s === "approved");
    if (approved.length > 0) {
        for (const [task] of approved)
            cards.push({ task, branch: task, deploysTo: dep, ...lights(task), released: gateAlreadyReleased(projectRoot, task) });
    }
    else if (scalar === "approved") {
        let branch = "HEAD";
        try {
            branch = execFileSync("git", ["branch", "--show-current"], { cwd: projectRoot, encoding: "utf8" }).trim() || "HEAD";
        }
        catch { /* */ }
        cards.push({ task: "(single loop)", branch, deploysTo: dep, ...lights("(single loop)"), released: gateAlreadyReleased(projectRoot, "(single loop)") });
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
export function foldHumanLines(buf, data) {
    const text = data.toString("latin1").replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "\x1b");
    const lines = [];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x0d || c === 0x0a) {
            lines.push(buf);
            buf = "";
        }
        else if (c === 0x1b || c === 0x03)
            buf = "";
        else if (c === 0x7f || c === 0x08)
            buf = buf.slice(0, -1);
        else if (c >= 0x20)
            buf = (buf + text[i]).slice(-64);
    }
    return { buf, lines };
}
/** Honor a pane-typed release: a completed line that IS the exact phrase,
 * while a gate is armed, releases through the SAME releaseGate the bar and
 * chat use (validation, durable echo, absorb-on-repeat included). The
 * keystrokes came through the cockpit's tokened human door — the OPERATOR's
 * keyboard — so the authority is the gate bar's, and the seat the pane
 * hosts never touches the emit. No gate armed / wrong phrase = nothing. */
export function honorPaneRelease(projectRoot, lines) {
    if (!lines.some((l) => l.trim().toLowerCase() === "merge go"))
        return {};
    const gate = pendingGates(projectRoot)[0];
    if (!gate)
        return {};
    const r = releaseGate(projectRoot, gate.task, "merge go");
    return r.ok ? { released: gate.task } : {};
}
/** The operator releases a gate by typing the phrase. Validates here AND lets
 * agentctl enforce it (defense in depth); returns the emit's output. */
export function releaseGate(projectRoot, task, phrase) {
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
    if (task && task !== "(single loop)")
        args.push(`branch=${task}`);
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
    }
    catch (e) {
        const err = e;
        return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
    }
}
/** The one-to-one thread: operator→orchestrator (the inbox audit mirror) +
 * orchestrator/engine→operator (the operator mailbox), merged in time
 * order. The chat IS the conversation, rendered from real artifacts. */
export function chatHistory(projectRoot, limit = 40) {
    const msgs = [];
    // Audit lines are `[iso] (sender) message`. The chat is ONLY the
    // operator↔orchestrator thread — inter-agent deliveries to the
    // orchestrator (coder/reviewer/QA verdicts) are filtered OUT by sender.
    // Escaped newlines are restored for display (2d multi-line fix); the
    // maildir-flavored `iso | from | body` mirror lines (mailbox.ts) parse too.
    const parse = (line) => {
        const m = line.match(/^\[([^\]]+)\]\s+\(([^)]+)\)\s+(.*)$/);
        if (m)
            return { at: m[1], sender: m[2], text: m[3].replaceAll("\\n", "\n") };
        const pipe = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+\|\s+([^|]+?)\s+\|\s(.*)$/);
        if (pipe)
            return { at: pipe[1], sender: pipe[2], text: pipe[3].replaceAll("\\n", "\n") };
        const legacy = line.match(/^\[([^\]]+)\]\s+(.*)$/); // pre-sender format
        if (legacy)
            return { at: legacy[1], sender: "operator", text: legacy[2] };
        return undefined;
    };
    // operator → orchestrator: only messages whose sender is the operator, and
    // never an agent verdict (belt: a seat that forgets --from defaults to
    // "operator" — those start with a [VERDICT] tag and are not human chat).
    const isVerdict = (t) => /^\[(PASS|FAIL|APPROVED|CHANGES_NEEDED|BLOCKER|DEPLOYED|MERGE)/i.test(t.trim());
    const inbound = join(projectRoot, ".agents", "state", "inbox", "orchestrator.md");
    if (existsSync(inbound)) {
        for (const line of readFileSync(inbound, "utf8").split("\n")) {
            const p = parse(line);
            if (p && p.sender === "operator" && !isVerdict(p.text))
                msgs.push({ from: "operator", at: p.at, text: p.text });
        }
    }
    // orchestrator/engine → operator: the operator's mailbox. The sender tag
    // decides the voice — mechanical lines render as the engine, never as the
    // orchestrator speaking words it didn't say.
    const outbound = join(projectRoot, ".agents", "state", "inbox", "operator.md");
    if (existsSync(outbound)) {
        for (const line of readFileSync(outbound, "utf8").split("\n")) {
            const p = parse(line);
            if (p)
                msgs.push({ from: p.sender === "engine" ? "engine" : "orchestrator", at: p.at, text: p.text });
        }
    }
    msgs.sort((a, b) => a.at.localeCompare(b.at));
    return msgs.slice(-limit);
}
/** PHASE-8 T5: pending previews (pages flagged for the human's eyes). */
export function pendingPreviews(projectRoot) {
    const f = join(projectRoot, ".agents", "state", "preview.json");
    if (!existsSync(f))
        return [];
    try {
        const items = JSON.parse(readFileSync(f, "utf8"));
        return Array.isArray(items) ? items : [];
    }
    catch {
        return [];
    }
}
/** The human's verdict on a preview: clear it, and (if changes) tell the
 * orchestrator. approve=true is the design-lock confirm. */
export function resolvePreview(projectRoot, approve, note) {
    const agentctlPath = join(projectRoot, ".agents", "bin", "agentctl.py");
    try {
        execFileSync("python3", [agentctlPath, "preview", "clear"], { cwd: projectRoot });
        const msg = approve
            ? "The operator reviewed the preview and it looks good — proceed."
            : `The operator wants changes to the preview: ${note ?? "(see notes)"}`;
        execFileSync("python3", [agentctlPath, "deliver", "orchestrator", "--from", "operator", msg], { cwd: projectRoot });
        return { ok: true };
    }
    catch {
        return { ok: false };
    }
}
/** Operator sends a message to the orchestrator (deliver → its mailbox). */
export function sendToOrchestrator(projectRoot, text) {
    try {
        const out = execFileSync("python3", [agentctl(projectRoot), "deliver", "orchestrator", "--from", "operator", text], {
            cwd: projectRoot, encoding: "utf8",
        });
        return { ok: true, out };
    }
    catch (e) {
        const err = e;
        return { ok: false, out: (err.stdout ?? "") + (err.stderr ?? "") };
    }
}
//# sourceMappingURL=teamctl.js.map