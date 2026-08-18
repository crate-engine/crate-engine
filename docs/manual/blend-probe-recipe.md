# The blend probe recipe — qualifying a new agent CLI

> S4 law (grill decisions, 2026-08-12): every seat whose staffed agent is
> **blend-eligible** runs blended by default — its pane IS the agent's live
> terminal session, and the engine delivers team mail into it with on-disk
> verification. An agent CLI joins the eligible list ONLY through this
> recipe: three live probes, each pinned in code. Until then the agent runs
> on the invisible headless fallback. New *models* on an already-eligible
> CLI need nothing — eligibility is per terminal tool, not per model.

Budget: about an hour per CLI, on a scratch rig. Everything below was how
claude / pi / codex earned their places (live probes, 2026-08-12) — and how
**agy** earned its own (2026-08-18; findings in `adapters/agy/adapter.md`).

> Harness lesson from the agy run, worth reading before you probe anything:
> **set the PTY window size.** A probe rig that forks a pty without
> `TIOCSWINSZ` gets a terminal a TUI will not paint into — agy emitted 566
> bytes in 45s and its trust modal never rendered, which read exactly like "the
> CLI silently eats the first paste". At 120x40 the modal appeared instantly.
> Two probe rounds were spent nearly filing a false blocker against someone
> else's software.

## Probe 1 — mid-turn paste queueing (is injection safe while it works?)

1. Launch the CLI interactively in a scratch dir; give it a long-running
   task (a multi-step tool loop).
2. While it is mid-turn, paste a multi-line block wrapped in bracketed
   paste (`ESC[200~ … ESC[201~`), wait ~1s, then send a SEPARATE `\r`
   (codex lesson: an immediate CR is swallowed into the paste as a
   composer newline).
3. PASS = the block queues visibly and is consumed after the current turn,
   nothing garbled, no popup eats it (`@`/`/` autocomplete popups must be
   killed by the bracketed paste — verify).
4. Note WHEN the queued message is written to the session file: mid-turn
   (claude, ~1.2s on a quiet boundary) or only at turn end (pi/codex).
   Either is fine — the verify ceiling already spans the turn (120s,
   `CLI_DELIVERY`) — but record it.

## Probe 2 — the session file (can delivery be verified on disk?)

1. Find where the CLI writes its session transcript on disk and how the
   file is keyed (claude: munged-cwd project dir; pi: munged-cwd sessions
   dir; codex: date-keyed rollouts with a cwd field in line 1).
2. Pin the JSONL shapes: what a USER-authored record looks like (the
   delivery verifier's target) and what an ASSISTANT record looks like
   (the early-stop watchdog's disarm signal).
3. PASS = a pasted marker string appears in a user record after submit,
   findable by simple parsing, and the file's location is derivable from
   (cwd, home, spawn time) alone.

## Probe 3 — first-launch dialogs (what eats the first paste?)

1. Launch the CLI in a BRAND-NEW directory and record every modal that
   blocks the composer (trust dialogs, onboarding). With fresh-per-task
   workers, "first launch" happens every task — a dialog that eats the
   first delivery is a recurring failure, not a one-off.
2. Pin the dialog's detection needle (over ANSI-normalized replay text —
   live panes render spacing as cursor-forward sequences) and its safe
   answer. The needle must be STRICT enough that it can never match a
   different modal whose default answer is destructive (the claude
   bypass-permissions lesson: its default is "No, exit").

## Wiring it in (all in `core/src/blend.ts` unless noted)

- `BlendCli` union + `blendEligible()` — add the CLI.
- `CLI_DELIVERY` — its submit gap + verify ceiling/poll (start from the
  probed timing law; 1s / 120s is the proven baseline).
- `verifyDelivered()` / `isUserRecordWithMarker()` / `isAssistantRecord()`
  — the probe-2 shapes.
- Session discovery — a `findBlendSessionCandidates` branch for its
  file keying (probe 2.3), newest-first, since-spawn.
- Trust handshake — a `needs<X>TrustAnswer()` + handshake if probe 3
  found dialogs (wire into `blendseat.ts` spawnPty).
- Gauge usage parsing (`sessionUsage`) if its transcript carries token
  usage — else the seat honestly shows the dim placeholder gauge.
- Tests: extend `core/test/blend.test.ts` with the pinned shapes (the
  existing per-CLI tests are the template).

Ship it through the normal ritual (suite on committed state → publish →
`crate update`) and the new CLI blends by default everywhere, same day.
