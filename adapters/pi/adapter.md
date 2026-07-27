# Adapter: Pi

Onboarding card for staffing a station with **Pi** (pi.dev) — a minimal, extensible
terminal agent harness. Pi runs on the operator workstation, so it is wired like the
**Claude** adapter. See `../claude/adapter.md` for the full four-wire detail and
`../README.md` for the model. **Bring your own Pi install + auth.**

> **Status: VERIFIED LIVE on the Reviewer seat (2026-07-02).** Proven in a real
> marketplace team boot (`dev/pdr/pi-native-agents.md` §15): Pi/GPT-5.5 launched on the
> ChatGPT subscription, read its binder, and delivered its onboarding ack to the
> orchestrator over the report wire, read-only enforced. **No open `CONFIRM`s remain
> for this seat.** (The 2026-07-02 proof ran over cmux — the 1.x transport, retired in
> 2.1; the seat/harness proof stands.)

## Why Pi is interesting here

Pi is a multi-provider harness (20+ providers, hundreds of models) with `read`,
`bash`, `edit`, `write` tools built in — so its native tool surface already covers the
engine's coder/reviewer needs (see the coder-seat audit in the PDR). One harness can
staff any seat on any model, and it exposes `--mode json|rpc` + `--print` for a future
programmable/headless seam.

## Install (bring your own)
```
curl -fsSL https://pi.dev/install.sh | sh
# or: npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## Auth — subscription OR API key (subscription preferred)

Pi authenticates two ways; **prefer subscription** to avoid per-token API spend:

- **Subscription (OAuth):** run `pi`, then `/login` — supports **ChatGPT Plus/Pro**,
  **Claude Pro/Max**, and **GitHub Copilot**. Uses your existing plan, no API key.
- **API key:** `export OPENAI_API_KEY=… / ANTHROPIC_API_KEY=… / GEMINI_API_KEY=…`.

> **Billing caveat (verify before relying):** third-party-harness use of an **Anthropic
> Claude** subscription is reported to bill **per-token as "extra usage," NOT against
> your Claude plan** — so Claude-via-Pi loses the flat-rate benefit. **ChatGPT Plus/Pro
> and Copilot** are reported to run at flat subscription rate through Pi. Net rule:
> keep Claude seats on first-party Claude Code (flat Claude sub); use Pi for seats on a
> *different* model (e.g. GPT-5.5 via your ChatGPT sub) — independence AND economics
> point the same way.

## Model selection

The model pins **at launch** in v0.79.x: `--model "<provider>/<id>"`
(e.g. `--model "openai/gpt-5.5"`), optionally `:<thinking>`. So the staffing sheet's
`<STATION>_MODEL` DOES apply — `launch.sh` passes it through as `--model "$1"`.

- An **empty** `<STATION>_MODEL` launches bare `pi`, letting the `/login` session pick
  the provider/model — the safe default when the exact id isn't known yet.
- **Find the exact id** for your plan after `/login`: `pi --list-models <search>`
  (e.g. `pi --list-models gpt`). Set `<STATION>_MODEL` to that id. **CONFIRM the
  provider/id string for a ChatGPT-subscription session** — it may differ from the
  API-key `openai/…` form.

## Wires (same as the Claude adapter unless noted)

1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` /
   `designer` / `tester`); `agentctl deliver` resolves the seat.
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator
   "<message>" --from <station>` (durable maildir + unconditional runner wake;
   agentctl's own `INBOX`/`QUEUED` output is the confirmation). Verdicts/reports go
   through the report skill (`config/skills/report.md`). Pi has a `bash` tool, so it
   runs the deliver itself.
4. **State signal** — the shared `python3 .agents/bin/agentctl.py emit --actor <station> …`,
   run from the repo root.

## Onboarding a Pi seat (what the orchestrator relays into the seat)

Launch is agent-level; the ROLE comes from the orchestrator's boot brief (same flow as
Claude). When onboarding a Pi station, the orchestrator's brief must include:

- **Read your binder + context on boot** — the station binder (`config/<role>.md`),
  `AGENTS.md`, `PROGRESS.md`, `ISSUES.md`, `config/INDEX.md`, `config/handoff-protocol.md`,
  your `state/<role>.md` — per the binder's "On boot".
- **Brief with `.agents/`-prefixed paths.** Pi resolves paths relative to the project
  root, so a brief that says `config/reviewer.md` instead of `.agents/config/reviewer.md`
  makes Pi correctly report the file "missing" (observed + corrected on the 2026-07-02
  boot — NOT a Pi bug; Pi reported accurately). Brief with the full `.agents/` prefix.
- **How to report:** `python3 .agents/bin/agentctl.py deliver orchestrator "<message>"
  --from <role>`. A printed ack reaches no one — it must be delivered.
- **Reviewer discipline (read-only):** a Reviewer never edits or merges. Pi can enforce
  this structurally with `--tools read,bash` (denies `edit`/`write`) — recommended for
  the Reviewer seat; until wired into launch, the brief states it as a hard rule
  ("read + bash only; never edit, never merge, report to the orchestrator only").
- **Write your state file BEFORE reporting.** Before delivering any report/verdict,
  write `state/<role>.md` via bash — this is in-protocol for EVERY seat **including
  read-only ones** (read-only is a law about the CODE, not your own state file). A
  verdict without a state-file write is incomplete. (Coaching added in Phase 2 after
  two live seats skipped it — PDR §16 follow-up + P1-8 finding 3.)
- **Relaunch, not exit.** Pi 0.80.x has no scriptable exit (survives ctrl+c/ctrl+d; a
  sent command line is executed by pi's own bash tool). Seat lifecycle is the app's:
  restart a Pi seat from the Team menu or with `crate relaunch <seat>` — seats never
  restart each other. Tracked as an upstream Pi question.
