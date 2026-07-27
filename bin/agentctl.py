#!/usr/bin/env python3
"""agentctl - event log + state machine for the .agents coordination system.

Dependency-free (no PyYAML needed). Run from the repo root (where .agents/ lives).

Usage:
  agentctl.py state                 print current session state
  agentctl.py tail [N]              show last N events (default 15)
  agentctl.py check <event>         exit 0 if legal from current state, else 1
  agentctl.py deliver <role> [--from R] <message...>
      Durable delivery: appends to the role's inbox mirror AND queues a
      maildir message (state/inbox/<role>/new/) that the seat's runner wakes
      on. The file IS the delivery — nothing to verify beyond this command
      succeeding. 'operator' is a valid target (the human's GUI chat).
  agentctl.py emit <name> [--actor R] [k=v ...]
      <name> = a handoff (config/handoffs.yaml) or a bare transition
               (config/state-machine.yaml). Validates the move; on success
               appends an event to state/events.log and advances the state; if
               it is a handoff, the signal is queued to the target seat's
               inbox automatically. On an illegal move it logs a REJECTED
               event and exits 1.
"""
import os, sys, datetime, re, subprocess, time

A = ".agents"
SM = os.path.join(A, "config", "state-machine.yaml")
HO = os.path.join(A, "config", "handoffs.yaml")
LOG = os.path.join(A, "state", "events.log")
RC = os.path.join(A, "rig.conf")

def die(msg, code=1):
    sys.stderr.write(str(msg).rstrip() + "\n"); sys.exit(code)

def load_sm():
    initial, always, trans, inblk = "down", [], {}, False
    with open(SM, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n"); s = line.strip()
            if not s or s.startswith("#"): continue
            if line.startswith("initial:"):
                initial = s.split(":", 1)[1].strip(); continue
            if line.startswith("always_legal:"):
                always = [x.strip() for x in s.split(":", 1)[1].split(",") if x.strip()]; continue
            if line.startswith("transitions:"):
                inblk = True; continue
            if inblk and (line.startswith(" ") or line.startswith("\t")):
                name, rest = s.split(":", 1)
                froms, to = rest.split("->")
                trans[name.strip()] = ([f.strip() for f in froms.split(",") if f.strip()], to.strip())
            else:
                inblk = False
    return initial, always, trans

def load_handoffs():
    h, inblk = {}, False
    with open(HO, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n"); s = line.strip()
            if not s or s.startswith("#"): continue
            if line.startswith("handoffs:"):
                inblk = True; continue
            if inblk and (line.startswith(" ") or line.startswith("\t")):
                name, rest = s.split(":", 1)
                parts = [p.strip() for p in rest.split("|")]
                while len(parts) < 5: parts.append("")
                h[name.strip()] = {"transition": parts[0], "from_role": parts[1],
                                   "to_role": parts[2], "signal": parts[3],
                                   "data": [d for d in parts[4].split(",") if d]}
            else:
                inblk = False
    return h

def current_state(initial):
    st = initial
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as fh:
            for raw in fh:
                if raw.lstrip().startswith("#"):
                    continue
                for tok in raw.split():
                    if tok.startswith("state="):
                        val = tok.split("=", 1)[1]
                        if val:
                            st = val
    return st

def rig_conf():
    """All `KEY="value"` pairs from the staffing sheet (.agents/rig.conf)."""
    m = {}
    if os.path.exists(RC):
        with open(RC, encoding="utf-8") as fh:
            for raw in fh:
                mt = re.match(r'\s*([A-Z][A-Z0-9_]*)\s*=\s*["\']?([^"\'#\n]*)', raw)
                if mt: m[mt.group(1)] = mt.group(2).strip()
    return m

# The seat roles a message can target (rig.conf `<ROLE>_TITLE` still names
# them for display; delivery is by role key, not title — T8: panes are gone).
ROLES = ("orchestrator", "coder", "reviewer", "designer", "tester")

def queue_message(role, sender, msg):
    """The durable delivery, headless (the ONLY transport since T8).
    1. Append to the human-readable mirror (state/inbox/<role>.md — audit
       trail; machines never read it).
    2. Queue a maildir message (state/inbox/<role>/new/) — the file the
       seat's runner wakes on. Format/naming MUST match core/src/mailbox.ts
       exactly (tmp+rename atomic; `<ISO> | <from> | <body>`, newlines
       escaped). The file IS the delivery AND the wake."""
    inbox_dir = os.path.join(A, "state", "inbox")
    os.makedirs(inbox_dir, exist_ok=True)
    # Audit line records the SENDER so the GUI chat can show ONLY the
    # operator↔orchestrator thread (never inter-agent verdicts). Format:
    # `[iso] (sender) message`, newlines escaped — the mirror is line-
    # oriented, so a raw multi-line message would silently truncate to its
    # first line in the chat thread (2d fix; the GUI unescapes for display).
    with open(os.path.join(inbox_dir, "%s.md" % role), "a", encoding="utf-8") as fh:
        fh.write("[%s] (%s) %s\n" % (now(), sender, msg.replace("\n", "\\n")))
    if role == "operator":
        return None  # the human reads the mirror in the GUI chat; no runner to wake
    new_dir = os.path.join(inbox_dir, role, "new")
    os.makedirs(new_dir, exist_ok=True)
    iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".%03dZ" % (int(time.time() * 1000) % 1000)
    name = "%d-%06d-%d.msg" % (int(time.time() * 1000), 0, os.getpid())
    tmp_p = os.path.join(new_dir, ".tmp-" + name)
    with open(tmp_p, "w", encoding="utf-8") as fh:
        fh.write("%s | %s | %s\n" % (iso, sender, msg.replace("\n", "\\n")))
    os.rename(tmp_p, os.path.join(new_dir, name))
    return name

def now():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

def append(line):
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")

def git_head_sha():
    """Full SHA of the working tree's current HEAD (read-only); '' if unresolved."""
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                           text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""

def git_branch():
    """Current branch name; '' when detached or unresolved."""
    try:
        r = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                           capture_output=True, text=True, timeout=10)
        b = r.stdout.strip() if r.returncode == 0 else ""
        return "" if b == "HEAD" else b
    except Exception:
        return ""

# ── the code_ready SHA-PIN (run #14: the Coder pushed a second commit AFTER
#    emitting code_ready, so Reviewer and QA verified DIFFERENT code; the
#    orchestrator caught it by hand — this makes the catch mechanical) ────────
PIN = os.path.join(A, "state", "pin-code_ready")

def write_pin(sha, branch, path=None):
    path = path or PIN
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("sha=%s branch=%s at=%s\n" % (sha, branch or "(detached)", now()))

def read_pin(path=None):
    """(sha, branch) from the pin file; (None, None) when absent/unreadable."""
    try:
        with open(path or PIN, encoding="utf-8") as fh:
            line = fh.read().strip()
        parts = dict(p.split("=", 1) for p in line.split() if "=" in p)
        return parts.get("sha"), parts.get("branch")
    except Exception:
        return None, None

def branch_tip(branch):
    """Tip SHA of <branch> (or current HEAD when detached-pin); '' if unresolved."""
    ref = branch if branch and branch != "(detached)" else "HEAD"
    try:
        r = subprocess.run(["git", "rev-parse", ref], capture_output=True,
                           text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""

# ── the knowledge flywheel (Phase-7 T1): AGENTS.md is the project law and it
#    ships as template placeholders. The orchestrator fills it on the FIRST
#    direction (bootstrap interview) and accrues at every close. This rung only
#    WARNS -- the law lives in orchestrator.md; a mid-flight rig must never be
#    blocked by it. Marker must match the templates/AGENTS.md banner verbatim.
FLYWHEEL_MARKER = "**Fill me in.**"
FLYWHEEL_EVENTS = ("start_impl", "start_design", "start_research", "close")

def flywheel_warning(transition):
    """A warning string when <transition> fires while AGENTS.md is still
    template placeholders (or absent); None otherwise. Never blocks."""
    if transition not in FLYWHEEL_EVENTS:
        return None
    try:
        with open("AGENTS.md", encoding="utf-8") as fh:
            if FLYWHEEL_MARKER not in fh.read():
                return None
    except OSError:
        pass  # absent counts as unfilled
    if transition == "close":
        return ("WARNING: AGENTS.md is still template placeholders at close -- the knowledge "
                "flywheel banked nothing this loop. The orchestrator owns AGENTS.md: fill it "
                "(bootstrap interview) and accrue the loop's Accrual: lines at close "
                "(orchestrator.md, 'The knowledge flywheel').")
    return ("WARNING: AGENTS.md is still template placeholders -- the bootstrap interview has "
            "not run. The orchestrator fills it on the FIRST direction (codebase scan first, "
            "one operator question round; orchestrator.md, 'The knowledge flywheel'). Work "
            "proceeds, but every station is flying without project law.")

def enforce_gate():
    """nm-gate enforcement is OPT-IN per rig: rig.conf `NMGATE_ENFORCE=1` turns the
    code_ready wall on. Absent/0/false => off. This lets the gate mechanism ship
    live (config/bin reach rigs by symlink) WITHOUT blocking rigs whose coders have
    not yet been taught to run it."""
    if os.path.exists(RC):
        with open(RC, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if line.startswith("#") or "NMGATE_ENFORCE" not in line:
                    continue
                val = line.split("NMGATE_ENFORCE", 1)[1]
                if "=" in val:
                    val = val.split("=", 1)[1]
                toks = val.strip().strip('"').strip("'").split()
                v = toks[0].strip('"').strip("'").lower() if toks else ""
                return v not in ("0", "false", "no", "off", "")
    return False

# ── P7-T6: concurrent loops (STRICTLY OPT-IN — rig.conf CONCURRENT_LOOPS=1) ──
# Task identity = the git branch (D1). events.log stays the ONE ground truth:
# task-scoped events carry `task=<branch>` and each task's state is DERIVED by
# filtering the log (D3) — no second source of truth, nothing can drift.

SESSION_EVENTS = ("boot", "checkpoint", "gate_pass")  # never task-scoped

def concurrent_mode():
    v = rig_conf().get("CONCURRENT_LOOPS", "").strip().lower()
    return v not in ("", "0", "false", "no", "off")

def task_states(initial):
    """(session_scalar, {task: state}) from events.log. Lines WITHOUT task=
    drive the legacy session scalar (boot etc.); lines WITH task= drive that
    task only."""
    scalar, tasks = initial, {}
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as fh:
            for raw in fh:
                if raw.lstrip().startswith("#"):
                    continue
                task, st = None, None
                for tok in raw.split():
                    if tok.startswith("task="):
                        task = tok.split("=", 1)[1]
                    elif tok.startswith("state="):
                        val = tok.split("=", 1)[1]
                        if val: st = val
                if not st:
                    continue
                if task:
                    tasks[task] = st
                else:
                    scalar = st
    return scalar, tasks

def task_state(initial, task):
    """One task's current state. A task with no events yet starts from `idle`
    once the session is booted (start_impl/start_design/start_research are all
    legal from idle), else from the un-booted session scalar."""
    scalar, tasks = task_states(initial)
    if task in tasks:
        return tasks[task]
    return "idle" if scalar not in ("down", "checkpointed") else scalar

def active_task_table(initial):
    """The live table: tasks whose state is not idle (closed tasks drop off)."""
    _, tasks = task_states(initial)
    return {t: s for t, s in tasks.items() if s != "idle"}

def pin_path_for(task):
    """Per-task pin file in concurrent mode (D4); the legacy single file else."""
    if not concurrent_mode() or not task:
        return PIN
    safe = re.sub(r"[^A-Za-z0-9._-]", "-", task)
    return os.path.join(A, "state", "pins", safe)

def operator_released(task):
    """PHASE-8 T3: True iff the operator emitted a valid gate_release for THIS
    task AFTER it most recently reached `approved` (a stale release from a
    prior loop cannot authorize a new merge). Scans events.log in order; the
    approved for the task arms the gate, a later operator GATE_RELEASE for the
    same task opens it, a DEPLOYED/REOPEN re-locks it."""
    armed, released = False, False
    if not os.path.exists(LOG):
        return False
    with open(LOG, encoding="utf-8") as fh:
        for raw in fh:
            if raw.lstrip().startswith("#"):
                continue
            toks = raw.split()
            evt = toks[1] if len(toks) > 1 else ""
            row_task = None
            actor = ""
            for t in toks:
                if t.startswith("task="): row_task = t.split("=", 1)[1]
                elif t.startswith("branch=") and row_task is None: row_task = t.split("=", 1)[1]
                elif t.startswith("actor="): actor = t.split("=", 1)[1]
            if task and row_task is not None and row_task != task:
                continue
            # Check the EVENT before the state token: a gate_release is an
            # always-event so its line ALSO carries the unchanged state=approved.
            # Track to the END (never early-return) so a later reopen/merge can
            # CONSUME a release — a stale release cannot authorize a new merge.
            if evt == "GATE_RELEASE" and actor == "operator":
                if armed:
                    released = True
            elif evt == "APPROVED" or "state=approved" in toks:
                armed, released = True, False  # a fresh approval needs a fresh release
            elif "state=deployed" in toks or "state=implementing" in toks:
                armed, released = False, False  # merged or reopened
    return armed and released

# ── the review/QA JOIN as PHYSICS (2026-07-24; FLAWS "the JOIN is manners, not
#    physics", live-proven race in dev/plan/proofs/speed-law/): in a parallel
#    review+QA loop the verifiers RECORD verdicts (`emit verdict`) and the
#    closure transitions (approved / changes_needed) belong to the orchestrator
#    alone — a solo verifier emit closed the loop while the other verifier was
#    still mid-turn. Binder text alone does not hold against a weak/fast model.
VERIFIER_ROLES = ("reviewer", "tester")

def parallel_verifiers():
    """The verifier seats the code_ready handoff mechanically summons
    (comma fan-out). The JOIN physics arms only when BOTH verify in parallel;
    a reviewer-only or test-led rig keeps its old shape untouched."""
    try:
        ho = load_handoffs().get("code_ready")
    except Exception:
        return ()
    if not ho:
        return ()
    targets = [r.strip() for r in ho["to_role"].split(",") if r.strip()]
    return tuple(r for r in VERIFIER_ROLES if r in targets)

def join_enforced():
    """Verdict-RECORD enforcement is OPT-IN per rig (rig.conf JOIN_ENFORCE=1) —
    the nm-gate land pattern: advisory first, enforce once the seats have
    learned `emit verdict`. The ACTOR check (the join is the orchestrator's)
    is always on — it needs no seat adoption to be safe."""
    v = rig_conf().get("JOIN_ENFORCE", "").strip().lower()
    return v not in ("", "0", "false", "no", "off")

def join_verdicts(task):
    """{role: result-or-None} for verifier verdicts recorded since this task's
    most recent CODE_READY (a fresh sha voids all verdicts — same freshness law
    as the pin). Task filtering mirrors operator_released."""
    v = {r: None for r in VERIFIER_ROLES}
    if not os.path.exists(LOG):
        return v
    with open(LOG, encoding="utf-8") as fh:
        for raw in fh:
            if raw.lstrip().startswith("#"):
                continue
            toks = raw.split()
            evt = toks[1] if len(toks) > 1 else ""
            row_task, actor, result = None, "", ""
            for t in toks:
                if t.startswith("task="): row_task = t.split("=", 1)[1]
                elif t.startswith("branch=") and row_task is None: row_task = t.split("=", 1)[1]
                elif t.startswith("actor="): actor = t.split("=", 1)[1]
                elif t.startswith("result="): result = t.split("=", 1)[1]
            if task and row_task is not None and row_task != task:
                continue
            if evt == "CODE_READY":
                v = {r: None for r in VERIFIER_ROLES}
            elif evt == "VERDICT" and actor in v:
                v[actor] = result
    return v

# ── WORKFLOW TIERING (2026-07-25; PDR dev/pdr/workflow-tiering.md, grilled +
#    locked with Adam): the orchestrator declares ONE tier at start_impl
#    (tier=chore|bug|feature); code enforces its meaning and double-checks it.
#    A chore skips the review/QA fan-out (nm-gate + the human merge gate remain);
#    deterministic ESCALATION FLOORS force a mis-guessed chore up to bug-tier
#    verification — a wrong guess can only ever mean MORE verification.
#    Undeclared tier = feature shape = exactly the pre-tiering loop; nothing
#    changes for a rig until its orchestrator starts declaring.
TIERS = ("chore", "bug", "feature")

LOCKFILES = ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "cargo.lock",
             "poetry.lock", "gemfile.lock", "composer.lock", "go.sum", "bun.lockb")
SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go",
               ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".sh", ".bash", ".zsh",
               ".vue", ".svelte", ".php", ".swift", ".kt")
PROTECTED_DEFAULT = ("migrations/", ".sql", "auth", "login", "session", "password",
                     "token", "payment", "billing", "checkout", "stripe", ".env",
                     "secret", "credential", ".github/workflows", "dockerfile",
                     "webhook")
DESIGN_DEFAULT = ("components/", "pages/", "app/", "views/", "layouts/",
                  "styles/", ".css", ".scss", "tailwind.config.")
DESIGN_EXCLUDE = ("app/api/", "pages/api/")  # server code inside view dirs is NOT design surface
GENERATED_DEFAULT = ("dist/", "build/", ".next/", "out/", "coverage/", ".min.",
                     ".agents/state/")  # rig runtime bookkeeping never counts

def tier_floors_conf():
    """Shipped defaults, tunable per project in AGENTS.md '## Tier Floors'
    (the review-signals tuning pattern — list lines EXTEND the defaults):
      - Chore diff ceiling: 40
      - Chore file ceiling: 3
      - Protected paths: <substring>, <substring>, ...
      - Design surface: <substring>, ...   (e.g. emails/ for styled-email products)
      - Generated paths: <substring>, ..."""
    conf = {"diff": 40, "files": 3, "protected": list(PROTECTED_DEFAULT),
            "design": list(DESIGN_DEFAULT), "generated": list(GENERATED_DEFAULT)}
    try:
        with open("AGENTS.md", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return conf
    inb = False
    for line in text.splitlines():
        if line.startswith("## "):
            inb = line.strip().lower() == "## tier floors"
            continue
        if not inb:
            continue
        s = line.strip().lstrip("-*").strip()
        low = s.lower()
        def _tail(prefix):
            return s[len(prefix):].strip()
        if low.startswith("chore diff ceiling:"):
            n = "".join(c for c in s if c.isdigit())
            if n: conf["diff"] = int(n)
        elif low.startswith("chore file ceiling:"):
            n = "".join(c for c in s if c.isdigit())
            if n: conf["files"] = int(n)
        elif low.startswith("protected paths:"):
            conf["protected"] += [p.strip().lower() for p in _tail("protected paths:").split(",") if p.strip()]
        elif low.startswith("design surface:"):
            conf["design"] += [p.strip().lower() for p in _tail("design surface:").split(",") if p.strip()]
        elif low.startswith("generated paths:"):
            conf["generated"] += [p.strip().lower() for p in _tail("generated paths:").split(",") if p.strip()]
    return conf

def run_git(args):
    """stdout of `git <args>` or None on any failure."""
    try:
        r = subprocess.run(["git"] + args, capture_output=True, text=True, timeout=20)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None

def loop_tier(task):
    """The tier declared on this task's most recent START_IMPL; None when the
    loop is untierd (pre-tiering rigs — full shape, nothing changes)."""
    tier = None
    if not os.path.exists(LOG):
        return None
    with open(LOG, encoding="utf-8") as fh:
        for raw in fh:
            if raw.lstrip().startswith("#"):
                continue
            toks = raw.split()
            evt = toks[1] if len(toks) > 1 else ""
            if evt != "START_IMPL":
                continue
            row_task, row_tier = None, None
            for t in toks:
                if t.startswith("task="): row_task = t.split("=", 1)[1]
                elif t.startswith("branch=") and row_task is None: row_task = t.split("=", 1)[1]
                elif t.startswith("tier="): row_tier = t.split("=", 1)[1]
            if task and row_task is not None and row_task != task:
                continue
            tier = row_tier  # each start_impl RESETS the declaration
    return tier if tier in TIERS else None

def design_locked_this_loop(task):
    """True iff a DESIGN_LOCKED is on record for this task since its loop last
    ended (deployed/close/abandon) — the designer floor stands down when the
    Designer already had its pass."""
    locked = False
    if not os.path.exists(LOG):
        return False
    with open(LOG, encoding="utf-8") as fh:
        for raw in fh:
            if raw.lstrip().startswith("#"):
                continue
            toks = raw.split()
            evt = toks[1] if len(toks) > 1 else ""
            row_task = None
            for t in toks:
                if t.startswith("task="): row_task = t.split("=", 1)[1]
                elif t.startswith("branch=") and row_task is None: row_task = t.split("=", 1)[1]
            if task and row_task is not None and row_task != task:
                continue
            if evt == "DESIGN_LOCKED":
                locked = True
            elif evt in ("DEPLOYED", "CLOSE", "ABANDON"):
                locked = False
    return locked

def effective_tier_at_join(task):
    """The tier_effective stamped on this task's most recent CODE_READY; None
    on untierd loops (join physics unchanged)."""
    eff = None
    if not os.path.exists(LOG):
        return None
    with open(LOG, encoding="utf-8") as fh:
        for raw in fh:
            if raw.lstrip().startswith("#"):
                continue
            toks = raw.split()
            evt = toks[1] if len(toks) > 1 else ""
            if evt != "CODE_READY":
                continue
            row_task, row_eff = None, None
            for t in toks:
                if t.startswith("task="): row_task = t.split("=", 1)[1]
                elif t.startswith("branch=") and row_task is None: row_task = t.split("=", 1)[1]
                elif t.startswith("tier_effective="): row_eff = t.split("=", 1)[1]
            if task and row_task is not None and row_task != task:
                continue
            eff = row_eff
    return eff

def manifest_reasons(base, paths):
    """Floor reasons from package.json diffs: a NET-NEW dependency name (a
    version bump of an existing dep stays chore-eligible) or ANY scripts-
    section change (a one-line postinstall ships arbitrary code) forces
    verify. Exact JSON compare, not grep."""
    import json as _json
    reasons = []
    secs = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")
    for p in paths:
        if os.path.basename(p).lower() != "package.json":
            continue
        def _load(ref):
            out = run_git(["show", "%s:%s" % (ref, p)])
            if out is None:
                return {}
            try:
                return _json.loads(out)
            except Exception:
                return None
        head_m, base_m = _load("HEAD"), _load(base)
        if head_m is None or base_m is None:
            reasons.append("unparsable manifest: %s" % p)
            continue
        base_deps = set()
        head_deps = set()
        for s in secs:
            base_deps |= set(base_m.get(s) or {})
            head_deps |= set(head_m.get(s) or {})
        new = sorted(head_deps - base_deps)
        if new:
            reasons.append("net-new dependency: %s (%s)" % (", ".join(new), p))
        if (base_m.get("scripts") or {}) != (head_m.get("scripts") or {}):
            reasons.append("manifest scripts changed: %s" % p)
    return reasons

def route_floors(declared):
    """(effective_tier, reasons, design_hit) — the escalation floors vs the
    branch's diff against main. Chore floors: ceiling (lockfiles/generated
    exempt from counts), new source files, protected paths, guardrail files
    (AGENTS.md + .agents/ — the limits cannot be edited by the tier that
    bypasses them), manifest rules, and gate proof (a chore's only mechanical
    safety is the wall, so no gate_pass = verify). An unresolvable diff also
    escalates: what cannot be proven small gets verified."""
    conf = tier_floors_conf()
    base = None
    for ref in ("origin/main", "main"):
        if run_git(["rev-parse", "-q", "--verify", ref]) is not None:
            base = ref
            break
    if base is None:
        eff = "bug" if declared == "chore" else declared
        return eff, ["no main base to diff against"], False
    numstat = run_git(["diff", "--numstat", "%s...HEAD" % base]) or ""
    lines, files, paths = 0, 0, []
    for row in numstat.splitlines():
        parts = row.split("\t")
        if len(parts) < 3:
            continue
        a, d, p = parts[0], parts[1], parts[2]
        paths.append(p)
        low = p.lower()
        exempt = os.path.basename(low) in LOCKFILES or any(g in low for g in conf["generated"])
        if not exempt:
            files += 1
            if a.isdigit(): lines += int(a)
            if d.isdigit(): lines += int(d)
    design_hit = any(
        not any(x in p.lower() for x in DESIGN_EXCLUDE)
        and any(s in p.lower() for s in conf["design"])
        for p in paths)
    if declared != "chore":
        return declared, [], design_hit
    reasons = []
    if lines > conf["diff"]:
        reasons.append("%d changed lines > chore ceiling %d" % (lines, conf["diff"]))
    if files > conf["files"]:
        reasons.append("%d files > chore ceiling %d" % (files, conf["files"]))
    added = (run_git(["diff", "--name-only", "--diff-filter=A", "%s...HEAD" % base]) or "").split("\n")
    for f in added:
        f = f.strip()
        if not f:
            continue
        low = f.lower()
        if os.path.basename(low) in LOCKFILES or any(g in low for g in conf["generated"]):
            continue
        if any(low.endswith(e) for e in SOURCE_EXTS):
            reasons.append("new source file: %s" % f)
    for p in paths:
        low = p.lower()
        if ".agents/state/" in low:
            continue  # runtime bookkeeping, not guardrail config (rigs gitignore it anyway)
        if os.path.basename(low) == "agents.md" or ".agents/" in low or low.startswith(".agents"):
            reasons.append("guardrail file (never a chore): %s" % p)
        elif any(s in low for s in conf["protected"]):
            reasons.append("protected path: %s" % p)
    reasons += manifest_reasons(base, paths)
    okg, detail = gate_ok_for_head()
    if not okg:
        reasons.append("no gate_pass on file for %s (a chore's only mechanical check is the wall)" % detail)
    return ("bug" if reasons else "chore"), reasons, design_hit

# ── the FLYWHEEL COMMIT (2026-07-25; FLAWS "rig working docs can stay
#    UNCOMMITTED forever"): the close emit mechanically lands the loop's doc
#    accruals. Grill pins (Adam): (1) the orchestrator commits, at loop close,
#    right after the merge lands on main — identity fallback per attach;
#    (2) SCOPE: ONLY the three working docs, never a sweep; (3) concurrent
#    closes never fight — commits land only when the MAINLINE is checked out
#    (serializes locally), index.lock races retry, push races rebase-retry.
DOC_FILES = ("AGENTS.md", "PROGRESS.md", "ISSUES.md")

def commit_loop_docs(task):
    """Commit + best-effort-push the working docs' accruals at close. Loud
    warnings, never a wedge — a close that cannot commit docs still closes."""
    if not git_head_sha():
        return  # not a git repo — nothing to mechanize
    branch = git_branch()
    if branch not in ("main", "master"):
        print("DOCS: accrual NOT committed — the repo is on %r, and the close commit lands "
              "only on the mainline (concurrent-loop safety). It will land at the next "
              "mainline close, or commit AGENTS.md/PROGRESS.md/ISSUES.md by hand."
              % (branch or "(detached)"))
        return
    present = [f for f in DOC_FILES if os.path.exists(f)]
    if not present:
        return
    try:
        r = subprocess.run(["git", "status", "--porcelain", "--"] + present,
                           capture_output=True, text=True, timeout=10)
        dirty = bool(r.stdout.strip()) if r.returncode == 0 else False
    except Exception:
        dirty = False
    if not dirty:
        return
    msg = "docs: loop close accrual%s (flywheel)" % ((" %s" % task) if task else "")
    committed = False
    for attempt in range(3):
        try:
            subprocess.run(["git", "add", "--"] + present, capture_output=True, timeout=10)
            c = subprocess.run(["git", "commit", "-q", "-m", msg, "--"] + present,
                              capture_output=True, text=True, timeout=15)
            if c.returncode == 0:
                committed = True
                break
            if "index.lock" in (c.stdout + c.stderr):
                time.sleep(0.5)
                continue
            # any other failure: retry once with the attach identity fallback
            # (no git identity on this account) — harmless if identity wasn't it
            c = subprocess.run(["git", "-c", "user.email=crate@local", "-c", "user.name=crate2",
                                "commit", "-q", "-m", msg, "--"] + present,
                               capture_output=True, text=True, timeout=15)
            if c.returncode == 0:
                committed = True
            break
        except Exception:
            time.sleep(0.5)
    if not committed:
        print("DOCS: WARNING — could not commit the loop's doc accruals (AGENTS/PROGRESS/ISSUES "
              "are DIRTY on %s). The flywheel's knowledge is unbanked until someone commits it." % branch)
        return
    sha = git_head_sha()[:9]
    pushed = ""
    if subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, timeout=10).returncode == 0:
        p = subprocess.run(["git", "push", "-q", "origin", branch], capture_output=True, text=True, timeout=30)
        if p.returncode != 0:
            subprocess.run(["git", "pull", "-q", "--rebase", "origin", branch],
                           capture_output=True, timeout=30)
            p = subprocess.run(["git", "push", "-q", "origin", branch], capture_output=True, text=True, timeout=30)
        pushed = ", pushed" if p.returncode == 0 else ", PUSH FAILED (push by hand)"
    print("DOCS COMMITTED: %s — the loop's AGENTS/PROGRESS/ISSUES accruals landed on %s%s (flywheel banked)."
          % (sha, branch, pushed))

def gate_ok_for_head():
    """True iff events.log holds a GATE_PASS tied to the current HEAD SHA. The SHA
    uniquely identifies the code state, so an older pass for the same SHA is still
    valid proof; any new commit invalidates it (forces a re-gate)."""
    head = git_head_sha()
    if not head:
        return False, "HEAD (unresolvable -- run from the repo root of a git checkout)"
    short = head[:9]
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as fh:
            for raw in fh:
                if "GATE_PASS" in raw and ("sha=%s" % head) in raw:
                    return True, "HEAD %s" % short
    return False, "HEAD %s" % short

def main():
    if not os.path.isdir(A):
        die("Run me from the repo root (no .agents/ directory here).")
    args = sys.argv[1:]
    if not args: die(__doc__)
    cmd = args[0]
    initial, always, trans = load_sm()

    if cmd == "preview":
        # PHASE-8 T5: flag a page for the human's eyes. `preview <url>
        # [--route /r] [--label "..."] [--from <seat>]` appends a pending
        # preview to state/preview.json (the GUI shows a Preview tab with a
        # dot; the human reviews desktop+mobile and confirms). `preview
        # clear` empties it. The design-lock-preview procedure delegates here.
        pv_path = os.path.join(A, "state", "preview.json")
        if len(args) > 1 and args[1] == "clear":
            if os.path.exists(pv_path): os.remove(pv_path)
            print("PREVIEW: cleared"); return
        if len(args) < 2:
            die("usage: preview <url> [--route /r] [--label \"...\"] [--from <seat>]  |  preview clear")
        url = args[1]; route = "/"; label = ""; frm = "orchestrator"; i = 2
        while i < len(args):
            if args[i] == "--route" and i + 1 < len(args): route = args[i+1]; i += 2; continue
            if args[i] == "--label" and i + 1 < len(args): label = args[i+1]; i += 2; continue
            if args[i] == "--from" and i + 1 < len(args): frm = args[i+1]; i += 2; continue
            i += 1
        import json as _json
        items = []
        if os.path.exists(pv_path):
            try: items = _json.load(open(pv_path, encoding="utf-8"))
            except Exception: items = []
        items.append({"url": url, "route": route, "label": label or route, "from": frm, "at": now()})
        os.makedirs(os.path.dirname(pv_path), exist_ok=True)
        with open(pv_path, "w", encoding="utf-8") as fh:
            _json.dump(items, fh)
        print("PREVIEW: queued %s%s for the human (GUI Preview tab)." % (url, route))
        return
    if cmd == "state":
        # `state --task <branch>` = that task's derived state (P7-T6).
        if len(args) > 2 and args[1] == "--task":
            print(task_state(initial, args[2])); return
        if concurrent_mode():
            table = active_task_table(initial)
            if not table:
                print("idle"); return
            for t in sorted(table):
                print("%s=%s" % (t, table[t]))
            return
        print(current_state(initial)); return
    if cmd == "tail":
        n = int(args[1]) if len(args) > 1 else 15
        lines = []
        if os.path.exists(LOG):
            with open(LOG, encoding="utf-8") as fh:
                lines = [l.rstrip("\n") for l in fh]
        print("\n".join(lines[-n:])); return
    if cmd == "check":
        # check [--task <branch>] <event>
        rest = args[1:]
        ck_task = None
        if rest and rest[0] == "--task":
            if len(rest) < 3: die("check --task needs a task and an event name")
            ck_task, rest = rest[1], rest[2:]
        if not rest: die("check needs an event name")
        ev = rest[0]
        cur = task_state(initial, ck_task) if ck_task else current_state(initial)
        froms = trans.get(ev, (None, None))[0]
        ok = ev in always or (froms is not None and cur in froms)
        print("legal" if ok else "ILLEGAL (state=%s)" % cur)
        sys.exit(0 if ok else 1)
    if cmd == "deliver":
        # deliver <role> <message...> — the DELIVERY QUEUE (P7-T6 task-0;
        # headless-only since T8: the cmux pane nudge is gone, and delivery
        # never depended on it — the FILE is the delivery and the wake).
        # 'operator' is a valid target but NOT a seat — it's the human's
        # mailbox (PHASE-8 T3 chat: the orchestrator replies here; the GUI
        # renders it). No runner; just the durable audit record.
        if len(args) < 3 or (args[1] not in ROLES and args[1] != "operator"):
            die("usage: deliver <role> <message...>  (roles: %s, or 'operator')" % ", ".join(ROLES))
        role = args[1]
        rest = list(args[2:])
        sender = "operator"
        if len(rest) > 2 and rest[0] == "--from":
            sender, rest = rest[1], rest[2:]
        msg = " ".join(rest).strip()
        if not msg: die("deliver: empty message")
        name = queue_message(role, sender, msg)
        print("INBOX: recorded for %s (state/inbox/%s.md) — the durable copy." % (role, role))
        if name:
            print("QUEUED: %s's runner wakes on it (state/inbox/%s/new/%s)." % (role, role, name))
        return
    if cmd == "emit":
        if len(args) < 2: die("emit needs a handoff or transition name")
        name, actor, kv, i = args[1], "?", [], 2
        while i < len(args):
            a = args[i]
            if a == "--actor" and i + 1 < len(args):
                actor = args[i + 1]; i += 2; continue
            if "=" in a: kv.append(a)
            i += 1
        ho = load_handoffs().get(name)
        transition = ho["transition"] if ho else name
        signal = ho["signal"] if ho else ""
        to_role = ho["to_role"] if ho else ""
        # ── P7-T6: per-task legality in concurrent mode ──────────────────────
        cur_task = None
        if concurrent_mode():
            scalar, _tasks = task_states(initial)
            if scalar not in ("down", "checkpointed", "initialized", "idle"):
                die("REJECTED: CONCURRENT_LOOPS=1 but this session's legacy scalar state is '%s' — "
                    "a half-flown scalar session cannot be reinterpreted per-task. Finish the "
                    "current loop with the flag OFF (reach idle), then flip the flag." % scalar)
            if transition not in SESSION_EVENTS:
                # Always-events resolve the key too when one is given (T6
                # Superman harvest, 2026-07-12: a task=-keyed gate_release
                # computed `cur` from the SESSION scalar and stamped that as
                # the task's state — knocking an approved task back to
                # initialized and making the released merge illegal). Only
                # non-always events REQUIRE the key; an un-keyed always-event
                # stays a scalar line, task-table-invisible.
                kvmap = dict(p.split("=", 1) for p in kv if "=" in p)
                cur_task = kvmap.get("task") or kvmap.get("branch")
                if not cur_task and transition not in always:
                    append("[%s] REJECTED event=%s actor=%s reason=no_task_key" % (now(), transition, actor))
                    die("REJECTED: '%s' needs task=<branch> (or branch=) in concurrent mode — an "
                        "un-keyed event cannot be filed to a task. Nothing was sent." % transition)
            cur = task_state(initial, cur_task) if cur_task else scalar
        else:
            cur = current_state(initial)
        if transition in always:
            new = cur
        else:
            spec = trans.get(transition)
            if not spec:
                die("Unknown transition '%s'. Check config/state-machine.yaml." % transition)
            froms, to = spec
            if cur not in froms:
                append("[%s] REJECTED event=%s actor=%s%s reason=illegal_from=%s"
                       % (now(), transition, actor, (" task=%s" % cur_task) if cur_task else "", cur))
                die("REJECTED: '%s' is not legal from %sstate '%s'. Legal from: %s. Nothing was sent."
                    % (transition, ("task %s's " % cur_task) if cur_task else "", cur, ", ".join(froms)))
            new = to
        if transition == "code_ready" and enforce_gate() and os.environ.get("NMGATE_OVERRIDE") != "1":
            okg, detail = gate_ok_for_head()
            if not okg:
                append("[%s] REJECTED event=code_ready actor=%s reason=no_gate_pass %s" % (now(), actor, detail))
                die("REJECTED: code_ready blocked by nm-gate -- %s has no recorded gate_pass.\n"
                    "  Build + verify on the PUSHED branch first (isolated worktree, real build):\n"
                    "      bash .agents/bin/nm-gate <branch>\n"
                    "  Then re-emit code_ready. (Emergency human bypass: prefix NMGATE_OVERRIDE=1 -- logged.)"
                    % detail)
        # ── WORKFLOW TIERING (2026-07-25): the ONE recorded tier call ────────
        # Declared at start_impl, validated here; its meaning is enforced at
        # code_ready (routing) and the join (verdict requirements) below.
        if transition == "start_impl":
            kvmap = dict(p.split("=", 1) for p in kv if "=" in p)
            t = kvmap.get("tier", "").strip().strip('"').strip("'").lower()
            if kvmap.get("tier") is not None and t not in TIERS:
                append("[%s] REJECTED event=start_impl actor=%s reason=bad_tier" % (now(), actor))
                die("REJECTED: tier must be one of chore|bug|feature (got %r). The rubric lives in "
                    "orchestrator.md ('The tier call'); when genuinely torn, declare the HIGHER tier. "
                    "Omit tier= entirely for the full (feature-shaped) loop. Nothing was started."
                    % kvmap.get("tier"))
            if t and kvmap.get("tier") != t:
                kv = [("tier=%s" % t) if a.startswith("tier=") else a for a in kv]
        # ── the JOIN as PHYSICS (2026-07-24) ─────────────────────────────────
        # verdict: a VERIFIER's recorded verdict — the join's raw material. An
        # always-event: state never moves; the record (+ the mechanical mail to
        # the orchestrator, via the handoff) is the whole point.
        if transition == "verdict":
            if actor not in VERIFIER_ROLES:
                append("[%s] REJECTED event=verdict actor=%s reason=not_a_verifier" % (now(), actor))
                die("REJECTED: verdict is a VERIFIER's record (--actor reviewer|tester). The "
                    "orchestrator emits the joined transition, never a verdict. Nothing was recorded.")
            kvmap = dict(p.split("=", 1) for p in kv if "=" in p)
            result = kvmap.get("result", "").strip().strip('"').strip("'").lower()
            if result not in ("approve", "reject"):
                append("[%s] REJECTED event=verdict actor=%s reason=bad_result" % (now(), actor))
                die("REJECTED: verdict needs result=approve or result=reject (got %r). "
                    "Nothing was recorded." % (kvmap.get("result", "")))
        # approved / changes_needed are the JOIN — refuse the live-proven race:
        # in a parallel review+QA loop only the orchestrator (or the human) may
        # close, and (JOIN_ENFORCE=1) only with BOTH verdicts on record.
        if transition in ("approved", "changes_needed") and len(parallel_verifiers()) >= 2:
            if os.environ.get("JOIN_OVERRIDE") == "1":
                kv.append("join_override=1")
                print("JOIN OVERRIDE: join checks skipped by the human -- recorded in the log.")
            elif effective_tier_at_join(cur_task) == "chore":
                # TIERING: no verifiers were summoned on an effective-chore
                # loop — there are no verdicts to wait for. The actor rule is
                # moot (nobody but the orchestrator is awake) and the human
                # merge gate still holds downstream.
                pass
            else:
                if actor not in ("orchestrator", "operator"):
                    append("[%s] REJECTED event=%s actor=%s%s reason=join_owner"
                           % (now(), transition, actor, (" task=%s" % cur_task) if cur_task else ""))
                    die("REJECTED: in a parallel review+QA loop the JOIN belongs to the ORCHESTRATOR — "
                        "a solo '%s' from %s would close the loop while the other verifier may still "
                        "be mid-turn. Record YOUR verdict instead:\n"
                        "      agentctl emit verdict --actor %s result=approve|reject%s report=\"...\"\n"
                        "  (it reaches the orchestrator mechanically; the orchestrator emits the joined\n"
                        "  transition once BOTH verdicts are on record). Nothing was emitted."
                        % (transition, actor, actor if actor in VERIFIER_ROLES else "<you>",
                           (" task=%s" % cur_task) if cur_task else ""))
                vmap = join_verdicts(cur_task)
                missing = [r for r in parallel_verifiers() if not vmap.get(r)]
                not_green = [r for r in parallel_verifiers() if vmap.get(r) and vmap[r] != "approve"]
                problems = []
                if missing:
                    problems.append("no verdict on record from: %s (since the last code_ready)" % ", ".join(missing))
                if transition == "approved" and not_green:
                    problems.append("recorded REJECT from: %s" % ", ".join(not_green))
                if problems:
                    detail = "; ".join(problems)
                    if join_enforced():
                        append("[%s] REJECTED event=%s actor=%s%s reason=join_incomplete"
                               % (now(), transition, actor, (" task=%s" % cur_task) if cur_task else ""))
                        die("REJECTED: the JOIN is not complete — %s.\n"
                            "  Each verifier records its verdict first:\n"
                            "      agentctl emit verdict --actor reviewer result=approve|reject%s\n"
                            "      agentctl emit verdict --actor tester result=approve|reject%s\n"
                            "  approved needs BOTH on record and BOTH approve; changes_needed needs BOTH\n"
                            "  on record (ONE consolidated rework round, not two). Emergency human\n"
                            "  bypass: prefix JOIN_OVERRIDE=1 -- logged. Nothing was emitted."
                            % (detail, (" task=%s" % cur_task) if cur_task else "",
                               (" task=%s" % cur_task) if cur_task else ""))
                    else:
                        print("WARNING: the JOIN is not mechanically complete -- %s. Confirm both "
                              "verdicts by hand before closing (rig.conf JOIN_ENFORCE=1 makes this "
                              "a refusal)." % detail)
        # SHA-PIN enforcement at the approved JOIN (run #14): the reviewed sha
        # was recorded when code_ready was emitted; if the branch tip moved
        # since, the two verification lenses were NOT looking at what would
        # merge -- refuse the join mechanically instead of trusting the
        # orchestrator to notice.
        if transition == "approved":
            ppath = pin_path_for(cur_task)
            psha, pbranch = read_pin(ppath)
            if psha:
                tip = branch_tip(pbranch)
                if tip and tip != psha:
                    append("[%s] REJECTED event=approved actor=%s%s reason=branch_moved pinned=%s tip=%s"
                           % (now(), actor, (" task=%s" % cur_task) if cur_task else "", psha[:9], tip[:9]))
                    die("REJECTED: the branch moved after code_ready -- pinned %s but %s is now at %s.\n"
                        "  Review/QA verdicts do not cover the current tip. Recover honestly:\n"
                        "      emit changes_needed, have the Coder finalize ONE commit, re-emit\n"
                        "      code_ready (which re-pins), and re-run Review + QA on the frozen sha.\n"
                        "  Nothing was approved." % (psha[:9], pbranch or "the branch", tip[:9]))
            else:
                print("WARNING: no code_ready pin on file (%s) -- the join cannot "
                      "mechanically verify Review and QA saw the sha that will merge. Confirm by hand."
                      % os.path.relpath(ppath, A))
        # PHASE-8 T3: the "merge go" gate is PHYSICS, not manners. The merge
        # (deployed) refuses unless the OPERATOR released THIS task since it
        # reached approved, by typing the exact phrase — mechanical +
        # auditable. The GUI validates the phrase too, but the log is the
        # real gate.
        if transition == "deployed":
            if not operator_released(cur_task):
                append("[%s] REJECTED event=deployed actor=%s%s reason=awaiting_merge_go"
                       % (now(), actor, (" task=%s" % cur_task) if cur_task else ""))
                die("REJECTED: the merge is HELD at the gate — no operator 'merge go' on file for %s.\n"
                    "  The human releases it (GUI gate card, or): agentctl emit gate_release --actor operator%s phrase=\"merge go\"\n"
                    "  Nothing was merged." % (("task %s" % cur_task) if cur_task else "this task",
                                               (" task=%s" % cur_task) if cur_task else ""))
        # gate_release: ONLY the operator, ONLY the exact phrase — the release
        # is recorded (an always-event) and consumed by the next deployed.
        if transition == "gate_release":
            kvmap = dict(p.split("=", 1) for p in kv if "=" in p)
            phrase = kvmap.get("phrase", "").strip().strip('"').lower()
            if actor != "operator":
                die("REJECTED: gate_release is the OPERATOR's alone (actor=operator). Nothing was released.")
            if phrase != "merge go":
                append("[%s] REJECTED event=gate_release actor=%s reason=wrong_phrase" % (now(), actor))
                die("REJECTED: the release phrase must be exactly 'merge go'. Nothing was released.")
        # Pin the reviewed sha the moment the Coder declares done. From here to
        # a verdict the branch is FROZEN (coder.md law); `approved` verifies it.
        post_append = []
        if transition == "code_ready":
            sha = git_head_sha()
            if sha:
                write_pin(sha, git_branch(), pin_path_for(cur_task))
                if not any(a.startswith("sha=") for a in kv):
                    kv.append("sha=%s" % sha[:9])
                print("PINNED: %s frozen at %s -- no more commits until a verdict returns "
                      "(the approved join verifies this exact sha)." % (git_branch() or "HEAD", sha[:9]))
            # ── the TIER ROUTER: the declared tier's meaning, mechanically ───
            declared = loop_tier(cur_task)
            if declared:
                effective, reasons, design_hit = route_floors(declared)
                if not any(a.startswith("tier=") for a in kv):
                    kv.append("tier=%s" % declared)
                kv.append("tier_effective=%s" % effective)
                if declared == "chore" and effective != "chore":
                    post_append.append("[%s] TIER_ESCALATED actor=agentctl from=chore to=%s%s reason=\"%s\""
                                       % (now(), effective,
                                          (" task=%s" % cur_task) if cur_task else "",
                                          "; ".join(reasons)))
                    print("TIER ESCALATED: declared chore, but %s.\n"
                          "  Bug-tier verification (Reviewer + QA) is mechanically summoned — a wrong\n"
                          "  guess only ever means MORE verification. The audit trail shows the guess\n"
                          "  AND the correction." % "; ".join(reasons))
                floor_pull = design_hit and not design_locked_this_loop(cur_task)
                if effective == "chore":
                    to_role = "orchestrator"
                    if floor_pull:
                        kv.append("design_flag=1")
                        print("DESIGN-FLAG: this chore touches the design surface (flag, not force — "
                              "the orchestrator/operator decide if the Designer looks).")
                    print("TIER: chore — verified by the wall + the human merge gate; routing "
                          "straight to the orchestrator (no review/QA fan-out).")
                elif floor_pull and to_role:
                    to_role = to_role + ",designer"
                    print("DESIGNER FLOOR: the delta touches the design surface with no design_locked "
                          "this loop — the Designer is pulled into the verify step (inclusion is "
                          "code's call; exclusion stays judgment).")
        if cur_task and not any(a.startswith("task=") for a in kv):
            kv.append("task=%s" % cur_task)  # every task-scoped event files under its task
        parts = ["[%s]" % now(), transition.upper(), "actor=%s" % actor] + kv + ["state=%s" % new]
        append(" ".join(parts))
        for line in post_append:
            append(line)
        # FLYWHEEL COMMIT: the close mechanically banks the loop's doc accruals
        # (scope: the three working docs only; mainline-only; loud, never a wedge).
        if transition == "close":
            commit_loop_docs(cur_task)
        print("OK: %s -> state=%s" % (transition, new))
        fw = flywheel_warning(transition)
        if fw:
            print(fw)
        if signal and to_role:
            # T8 (headless-only): the handoff signal is QUEUED mechanically —
            # no printed delivery commands for the emitter to forget. The
            # maildir file is the delivery and the wake; duplicates with a
            # seat's own follow-up report are harmless (at-least-once law).
            # SPEED LAW (2026-07-14): to_role may be a comma list — the signal
            # FANS OUT to every target at the same instant (parallel review+QA
            # with no orchestrator relay turn; every mail costs a full turn-
            # spawn at its recipient, so mechanical mail never routes through
            # a model).
            msg = signal + ((" " + " ".join(kv)) if kv else "")
            for tr in [r.strip() for r in to_role.split(",") if r.strip()]:
                if tr in ROLES or tr == "operator":
                    qname = queue_message(tr, actor, msg)
                    if qname:
                        print("SIGNAL QUEUED for %s (state/inbox/%s/new/%s) — its runner wakes on it." % (tr, tr, qname))
                    else:
                        print("SIGNAL RECORDED for the operator (state/inbox/operator.md — the GUI chat).")
                else:
                    print("SIGNAL NOT QUEUED: handoff target %r is not a known role (%s, or 'operator'). "
                          "Deliver it by hand: python3 .agents/bin/agentctl.py deliver <role> --from %s \"%s\""
                          % (tr, ", ".join(ROLES), actor, msg))
        return
    die("Unknown command '%s'.\n%s" % (cmd, __doc__))

if __name__ == "__main__":
    main()
