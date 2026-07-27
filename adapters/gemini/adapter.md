# Adapter: Gemini CLI

Onboarding card for staffing a station (usually the Coder) with **Gemini CLI** — Googles terminal coding agent.
Gemini CLI is an interactive terminal coding agent that runs on the operator workstation,
so it is wired like the **Claude** adapter. See
`../claude/adapter.md` for the full four-wire detail; this card notes only what is
specific to Gemini CLI. **Bring your own Gemini CLI install + auth — the engine never handles keys.**

## Launch
`launch.sh` echoes:  `gemini ${1:+--model $1}`
> `--model/-m` VERIFIED against the shipping CLI's --help (npx, 2026-07-14).

## Headless seat wire (2026-07-14 — WIRED, not yet battle-tested)
The engine's runner drives Gemini CLI one turn at a time (turn.ts):
`gemini -p "<prompt>" -o stream-json [--approval-mode yolo (walled only)] [-m <model>]`
- Flag surface VERIFIED against the shipping CLI's `--help` (npx, 2026-07-14):
  `-p` is the documented headless mode; `-o stream-json` is parseable output;
  `--approval-mode yolo` rides ONLY inside a rendered crate wall (and the
  engine NEVER passes gemini's own `--sandbox` under a wall — both are
  Seatbelt, and Seatbelt doesn't nest).
- Stateless v1: `--resume` takes "latest"/index per the help — whether it
  accepts a session id CONFIRMs on first live use before sessions are wired.
- Detection: binary `gemini` on PATH + `~/.gemini/oauth_creds.json` (Google
  sign-in) or `GEMINI_API_KEY`.
- Catalog: offered with model = account default; labeled "not yet
  battle-tested" on every seat.

## Wires (same as the Claude adapter unless noted)
1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` / `designer` / `tester`).
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator "<message>" --from <station>`
   (durable maildir + runner wake); verdicts/reports via the report skill (`config/skills/report.md`).
4. **State signal** — the shared `agentctl emit --actor <station> ...`, run from the repo root.

Models are a staffing value (`<STATION>_MODEL`), never a separate adapter.
