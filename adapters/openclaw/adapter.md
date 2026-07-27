# Adapter: OpenClaw

Onboarding card for staffing a station with **OpenClaw** (openclaw.ai) — an
open-source, autonomous personal-AI agent that runs locally with full system
access. It runs on the operator workstation, so it is wired like the **Claude**
adapter. See `../claude/adapter.md` for the full four-wire detail.
**Bring your own OpenClaw install + auth.**

> Note: OpenClaw is broader than a focused coding agent (it also spans chat apps
> like WhatsApp/Telegram). For the Coder station, confirm it follows the binder's
> coordination protocol (reads its role doc, delivers its report, emits state)
> before relying on it unattended.

## Install (bring your own)
```
curl -fsSL https://openclaw.ai/install.sh | bash
# or: npm i -g openclaw
# first-time setup: openclaw onboard
```

## Launch
`launch.sh` echoes:  `openclaw`
> CONFIRM: the exact run command (vs `openclaw onboard` for first-time setup) and
> the model-selection method.

## Headless seat wire — NOT YET (2026-07-14)
OpenClaw is detected (binary `openclaw` on PATH) but is NOT offered in the
staffing catalog and has no headless turn wire: its run command and
non-interactive mode are unconfirmed, and a wire guessed wrong would fail
every turn. Confirm the shapes against a real install, then wire it like
opencode/gemini in `core/src/turn.ts` (buildHeadlessInvocation) and add its
catalog row.

## Wires (same as the Claude adapter unless noted)
1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` / `designer` / `tester`).
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator "<message>" --from <station>`
   (durable maildir + runner wake); verdicts/reports via the report skill (`config/skills/report.md`).
4. **State signal** — the shared `agentctl emit --actor <station> ...`, run from the repo root.

Models: bring hosted / subscription / gateway / local — configured inside OpenClaw.
