# Adapters — the onboarding cards (Layer 3)

The Crate Engine is built in three layers. Keeping them separate is what turns
the engine from one person's private harness into a portable product.

| Layer | What it holds | Where it lives |
|-------|---------------|----------------|
| **1 — SOP binder** | agent-neutral station missions + the flow, gates, state machine | `config/` |
| **2 — Staffing sheet** | which agent fills which station, per project / machine | `rig.conf` |
| **3 — Adapters** (this dir) | how to run ONE agent type at any station | `adapters/<agent>/` |

A **binder** file (e.g. `config/coder.md`) says WHAT a station does and how work
routes — in language a stranger could read with no knowledge of any specific
agent, tool, host, or path. A binder file never names an adapter.

An **adapter** (an "onboarding card") answers, for ONE agent type, the mechanics
every station needs. These are **the four shared wires** — the same mechanics
that used to repeat near-verbatim in every role file:

1. **Run-location** — where this agent runs and how it reaches the repo.
2. **Peer resolution** — how it finds the other stations (role keys:
   orchestrator / coder / reviewer / designer / tester).
3. **Report delivery** — how it delivers a result so it REACHES the orchestrator
   (a result printed in the agent's own transcript reaches no one) — the
   `agentctl deliver` maildir wire + the report skill.
4. **State signal** — how it invokes a state-machine transition. The transition
   *vocabulary* (boot, design_locked, code_ready, approved, changes_needed,
   bugs_found, verified, deployed, checkpoint) is binder/mission and lives in
   `config/state-machine.yaml` + `config/handoff-protocol.md`; the adapter only
   says how THIS agent runs the emit and delivers the printed signal.

Plus the onboarding basics: the launch command, and any tools/plugins this agent
*recommends* (plugins live on the machine the agent runs on — never inside a repo).

## How the layers bind

The **staffing sheet** (`rig.conf`) maps each station to an agent — e.g.
`coder=claude`, `reviewer=pi`. The launcher reads that and, per station,
applies the matching `adapters/<agent>/adapter.md`. To swap the agent at a
station, change one line in the staffing sheet; the binder never changes.

## The stranger test

Every line belongs to exactly one layer. The test: *could a stranger with zero
knowledge of this user, their machine, or their tools use this line as written?*
**Yes →** it's a house rule — it stays in the binder. **No →** it's an adapter or
staffing-sheet line, and it moves out.

## Adapters present (the starter library)

Bring your own coding agent (installed + authed) — the engine never handles keys.
Adding a *known* agent = staff a station with it (`<STATION>_AGENT=<name>`). A new
agent the library doesn't cover = `crate adapter new <name>`.

- `claude/`   — Claude Code (workstation). Also carries `orchestrator-ops.md`.
- `codex/`    — OpenAI Codex CLI (workstation).
- `aider/`    — Aider (workstation).
- `opencode/` — OpenCode (workstation).
- `gemini/`   — Gemini CLI (workstation).
- `pi/`       — Pi (pi.dev) — multi-provider agent harness (15+ providers via API key/OAuth); model chosen in-session.
- `openclaw/` — OpenClaw (openclaw.ai) — open-source autonomous local agent.

Models are a staffing value (`<STATION>_MODEL`), never a separate adapter. In the
newer adapters, launch flags are marked **CONFIRM** — verify against
your installed version on first use.
