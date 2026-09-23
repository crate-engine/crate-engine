# Adapter: Pi — Orchestrator ops

The coordination machinery for an orchestrator staffed by **Pi** (CE-171: the
binder sends every orchestrator to "your adapter's orchestrator-ops card", and a
pi orchestrator's first boot read ENOENT). The binder (`config/orchestrator.md`)
says WHAT the jobs accomplish and the rails; this card is HOW a Pi orchestrator
drives the wires. The four shared wires are in `adapter.md`.

Every orchestrator operation is `python3 .agents/bin/agentctl.py …` plus plain
shell, and Pi's built-in `bash` tool runs both. So the step lists are
harness-neutral and live in ONE place: **`../claude/orchestrator-ops.md`**.
Follow its INITIALIZE, RECOVER, Handoff, CHECKPOINT, `.status`, Context-monitor
and Operational-gotchas sections as written. Where it names a Claude tool, use
Pi's `bash` tool. The one real difference is the backstop watcher (below).

## Boot reads (ONE round-trip)

Read everything in a single `bash` call:

    for f in .agents/config/orchestrator.md AGENTS.md PROGRESS.md ISSUES.md \
             .agents/rig.conf .agents/adapters/pi/adapter.md \
             .agents/adapters/pi/orchestrator-ops.md \
             .agents/adapters/claude/orchestrator-ops.md \
             .agents/state/session.md; do echo "=== $f"; cat "$f" 2>/dev/null; done

A missing file (`session.md` on a first boot) prints its header and nothing else.
That is expected, not a finding.

## Dispatching to a seat (EVERY send)

    python3 .agents/bin/agentctl.py deliver <seat> --from orchestrator "<brief>"

Replies to the human use the same wire:
`deliver operator --from orchestrator "<plain-words reply>"`. `agentctl`'s own
`INBOX`/`QUEUED` output is the verification. Sign every send `--from orchestrator`
(since CE-185 a seat that signs as anyone else is refused).

## Backstop watcher: the engine's wake, not a held turn

The Claude card launches `.agents/bin/rig-wait.sh` as a BACKGROUND job that
re-invokes the agent when it exits. Pi's `bash` tool runs in the foreground, so
the same command would hold your turn open. Do not do that. Pi's backstop is the
engine's own delivery queue:

- `code_ready` fans out to the Reviewer and QA mechanically, and each verifier's
  `emit verdict` mails you `[VERDICT]`. Those mails wake your runner. After a
  dispatch, **end the turn**.
- On every wake, read ground truth before acting: `agentctl state`,
  `agentctl tail 20`. A forgotten delivery surfaces there.
- If you must confirm a transition inside the same turn, poll once with
  `agentctl state` (never a sleep-loop). Otherwise wait for the next wake.
