---
name: qa-method
type: skill
description: The QA station's run recipe — the exact order and completeness bar for a runtime QA pass. Use on EVERY dispatched QA run (intent test, critical paths, retest). Prevents the two classic misses; a pass that skips a step is not a pass.
inputs: the change INTENT (from the orchestrator); AGENTS.md critical paths; the dev URL; qa-sweep + agent-browser
outputs: a complete verdict (PASS/BUGS_FOUND) with numbered bugs, repro, severity, evidence paths
side_effects: browser automation against the dev build; evidence files written; no code changes
---

# qa-method — the run recipe

Work the steps IN ORDER. Each is mandatory; "I tested some paths" is not a pass.

## 1. Sweep first (the cheap deterministic floor)

Run `qa-sweep --project . --out <evidence-dir>` and READ its JSON. It gives you
per-route × viewport: console errors on load, responses ≥400, horizontal overflow,
screenshots. Anything it flags becomes a numbered finding with the JSON as evidence.

## 2. Regression — the accrued critical paths, BEFORE the new thing (P7-T3)

Drive every `AGENTS.md` Critical Path behaviorally (the sweep's load checks are
the floor, not the drive): mobile-first (390×844 before desktop), unhappy paths
included (invalid input must show its plain-words message — absence of an error
message IS the bug); tap-targets ≥44px and overflow per binder.

The viewport command is `agent-browser set viewport <w> <h>` (e.g.
`agent-browser set viewport 390 844`) — note the `set`. CE-133: the bare form
(`agent-browser viewport …`) errors "Unknown command" but the session KEEPS its
previous size, so a following screenshot silently captures the wrong width.
After setting, treat any "Unknown command" from the set as a HARD stop — a
mobile finding proven at desktop width is not evidence. The accrued
list is what the team already PROVED — re-prove it first, and LEAD your
verdict with its result.

## 3. Intent test — the HAPPY PATH with the claimed output, verified EXACTLY

The #1 classic miss. Exercise the primary flow with **valid, default inputs** as a
real user would, and compare the ACTUAL output against the claimed intent
**character-for-character where the claim is specific** (formatting, wording, counts,
units — e.g. "grouped digits + exactly two decimals" means check the digits, not just
that "a number rendered"). An output that renders but violates the claim is a bug.
Add the exploratory edges your judgment says THIS change could break.

Then the **NEGATIVE-INPUT MATRIX** on every input surface the change touches
(the ticket-#4 miss: a malformed nonblank email sailed through a full runtime
pass because only empty-vs-valid was driven). Three mandatory rows per
form/field/action — each must produce a plain-words rejection or a safe no-op:
1. **Malformed nonblank** (`not-an-email`, junk in numeric fields) — drive the
   submit the way the UI wires it: anchor/JS handlers BYPASS native `type=`
   validation, so a passing native check proves nothing about the real path.
2. **Boundary** — too long, too short, zero, max, leading/trailing whitespace.
3. **Repeated/rapid submission** — double-click, resubmit, back-and-resubmit.
Absence of an error message IS the bug; the matrix result rides your verdict
alongside the happy-path result.

### Clicking: an element containing an `<svg>` is INVISIBLE to text locators (CE-108)

Measured against the shipped `agent-browser` 0.31.1, 2026-08-17. If a button or
link contains an inline `<svg>` — an icon beside its label, which is most modern
CTAs — **every text- and role-based locator fails to find it**:

    agent-browser find text "Browse Inventory" click        # ✗ Element not found
    agent-browser find text "Browse" click                  # ✗ (substring is no help)
    agent-browser find role link click --name "Browse …"    # ✗ (the a11y name misses it too)
    agent-browser click "text=Browse Inventory"             # ✗

CSS selectors DO reach it — use one:

    agent-browser click "#browse-cta"
    agent-browser click "a:has(svg)"
    agent-browser click "nav a[href='/inventory']"

It is not silent: the command prints `✗ Element not found` and exits 1. **Treat
that as "my locator was wrong", not "the element is missing" — and never as "the
feature is broken".** Filing a bug against the app because a text locator could
not see an icon button is a false finding; confirm with `agent-browser snapshot`
or a CSS click before you write it up. Multi-line text and flex layout are
innocent; the `<svg>` child is the whole cause.

## 4. Console after EVERY interactive action (the #2 classic miss)

Page-load console capture (the sweep) does NOT cover actions. After EACH submit /
click / navigation, run BOTH commands and read their output before moving on:

    agent-browser console
    agent-browser errors

Plain `agent-browser open <dev-url>` WORKS inside your wall — the in-box shim
detects the wall and launches the cached wall-safe chromium with the right
flags for you (the browser-tooling fix, 2026-08-11). End your session with
`agent-browser close`. If open/navigate still fails (e.g. no cached playwright
chromium), fall back to the proven connect ladder:

    qa-chrome start
    agent-browser connect 9223
    ... your session ...
    agent-browser close && qa-chrome stop

Every `[error]` line is a numbered finding even when the UI looks fine — quote the
line as evidence. NEVER claim "zero console errors" unless you ran these commands
after your actions and they came back clean; a green claim without the command run
is a false report.

## 5. Accessibility pass on the CHANGED pages (P7-T3)

    axe-check --base <dev url> --routes <changed routes> --out <evidence-dir>

In-box, on your PATH. Each violation is a numbered finding (axe impact =
severity hint; critical/serious ≥ SHOULD-FIX). "AXE NOT VERIFIED — ..." =
report that line verbatim as a DEGRADE — never a failure, never a silent skip.
IF `AGENTS.md` declares a perf budget, verify + report it here; no declared
budget = skip silently.

## 6. Verdict + evidence, protocol shape — REGRESSION LEADS

[PASS] or [BUGS_FOUND], reported in this order: (a) the regression result per
accrued path, (b) intent/exploratory findings, (c) the axe pass or its degrade
note. Numbered bugs each with repro steps, severity (BLOCKER / SHOULD-FIX /
NIT), and an evidence path; name what you did NOT verify.
Then deliver per the report skill (state file first — `.agents/state/tester.md`, full prefix).
