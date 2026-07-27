# Pre-review checks (automated gate)

**Extracted from:** `config/orchestrator.md` — LOOP A brain hardening

The automated build/verify gate now runs at the CODER, before `code_ready`: the
coder runs `bash .agents/bin/nm-gate <branch>`, which records a `gate_pass` that
`agentctl` requires before it will accept `code_ready` (on a rig with
`NMGATE_ENFORCE=1`). So by the time `[CODE_READY]` reaches you it is ALREADY
gate-green — do NOT re-run the build yourself.

Your job at `[CODE_READY]`: surface the gate's one-line verdict to the human,
run the deep-review signal check, then relay to the Reviewer:
  bash .agents/bin/review-signals <branch>
Read only its last (verdict) line. `DEEP-REVIEW: RECOMMENDED (...)` → the
Reviewer's dispatch carries `[DEEP_REVIEW]` and you ANNOUNCE the escalation +
reason to the human (auto-escalated structural findings are SHOULD-FIX
`[quality]` — the binder's severity translation). `no` / `disabled (AGENTS.md)`
→ standard review, say nothing. Deterministic and read-only (no agentctl
events). The coder owns the fix loop for a red gate (it cannot signal
`code_ready` until the gate is green). If you ever need to run the gate manually
(e.g. a rig WITHOUT enforcement), the read-only form is:
  bash .agents/bin/precheck.sh <branch>
Read ONLY the compact verdict — do NOT pull full build logs into context.
precheck.sh builds in an isolated worktree (own .next, shared node_modules, auto
teardown) and never touches the live dev server. Running it emits no agentctl
events — it is read-only w.r.t. rig state.

Lint is ADVISORY by default (repos carry baseline eslint debt, so a whole-repo lint would never pass the wall). A rig can opt into a per-file delta gate with `NMGATE_LINT_DELTA=1`: the gate then lints only the files a branch changed and fails only on errors a changed file ADDS vs `origin/main` (legacy baseline errors are never counted). This catches newly-introduced lint without forcing a cleanup of pre-existing debt.

The gate also runs a mobile-overflow check on a green build: it serves the built
site on a verified-free port and uses Playwright (iPhone 13 viewport) to measure
horizontal overflow and capture full-page screenshots for the key routes. Mobile
results are NON-BLOCKING — a MOBILE overflow or error never changes RESULT, never
flips the exit code, and never bounces to the coder. SURFACE them to the human instead:
report any per-route OVERFLOW findings and the screenshots path, and the human reviews
the screenshots.
