# Adapter: Aider

Onboarding card for staffing a station (usually the Coder) with **Aider** — a popular open-source AI pair-programming CLI.
Aider is an interactive terminal coding agent that runs on the operator workstation,
so it is wired like the **Claude** adapter. See
`../claude/adapter.md` for the full four-wire detail; this card notes only what is
specific to Aider. **Bring your own Aider install + auth — the engine never handles keys.**

## Launch
`launch.sh` echoes:  `aider${1:+ --model $1}`
> CONFIRM against your installed Aider: the exact model flag.
> (Card previously documented `--model ${1:-<model>}`; the script's actual
> shape is above — fixed 2026-07-14.)

## Headless seat wire (2026-07-14 — WIRED, not yet battle-tested)
The engine's runner drives Aider one turn at a time (turn.ts):
`aider --message "<prompt>" --yes-always --no-stream [--model <model>]`
- `--message` (one-shot) and `--yes-always` (automation posture) are aider's
  long-documented non-interactive shape; CONFIRM against your installed
  version on the first live turn.
- Stateless v1: aider keeps its own chat history in-repo; the engine does not
  resume a session, so every turn carries the full orientation prompt.
- Detection: binary `aider` on PATH; auth is your provider keys in aider's
  own config/env (the engine never checks or handles them).
- Catalog: offered with model = your configured default; labeled "not yet
  battle-tested" on every seat.

## Wires (same as the Claude adapter unless noted)
1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` / `designer` / `tester`).
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator "<message>" --from <station>`
   (durable maildir + runner wake); verdicts/reports via the report skill (`config/skills/report.md`).
4. **State signal** — the shared `agentctl emit --actor <station> ...`, run from the repo root.

Models are a staffing value (`<STATION>_MODEL`), never a separate adapter.
