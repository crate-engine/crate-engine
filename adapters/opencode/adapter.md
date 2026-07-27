# Adapter: OpenCode

Onboarding card for staffing a station (usually the Coder) with **OpenCode** — an open-source terminal coding agent.
OpenCode is an interactive terminal coding agent that runs on the operator workstation,
so it is wired like the **Claude** adapter. See
`../claude/adapter.md` for the full four-wire detail; this card notes only what is
specific to OpenCode. **Bring your own OpenCode install + auth — the engine never handles keys.**

## Launch
`launch.sh` echoes:  `opencode ${1:+--model $1}`
> CONFIRM against your installed OpenCode: whether the TUI takes `--model` at
> launch (headless `run` verified below; the TUI may pick models in-app instead).

## Headless seat wire (2026-07-14 — WIRED, not yet battle-tested)
The engine's runner drives OpenCode one turn at a time (turn.ts):
`opencode run --format json [--auto (walled only)] [--model <provider/model>] [--session <id>] "<prompt>"`
- Flag surface VERIFIED against the shipping CLI's `run --help` (npx, 2026-07-14):
  `--format json` (raw events), `-s/--session` (resume), `-m/--model`, `--auto`
  (auto-approve — upstream marks it dangerous, so the engine passes it ONLY
  inside a rendered crate wall, the same defense-in-depth as claude/codex).
- Session id + token usage are parsed defensively from the JSON events; the
  exact event shapes CONFIRM on the first live turn.
- Detection: binary `opencode` on PATH + `~/.local/share/opencode/auth.json`
  (`opencode auth login`).
- Catalog: offered with model = your configured default; every seat labels it
  "not yet battle-tested" until a ladder run proves it.

## Wires (same as the Claude adapter unless noted)
1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` / `designer` / `tester`).
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator "<message>" --from <station>`
   (durable maildir + runner wake); verdicts/reports via the report skill (`config/skills/report.md`).
4. **State signal** — the shared `agentctl emit --actor <station> ...`, run from the repo root.

Models are a staffing value (`<STATION>_MODEL`), never a separate adapter.
