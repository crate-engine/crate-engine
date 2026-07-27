# Adapter: Codex

Onboarding card for staffing a station (usually the Coder) with the **OpenAI Codex
CLI**. Like Claude Code, Codex is an interactive terminal agent that runs on the
operator workstation — so it is wired like the **Claude** adapter, not like Hermes
(host-run). See `../README.md` for the layer model.

> This adapter doubles as the worked example of **"how to add any new agent"**:
> answer the four wires + a launch command. Models within Codex are NOT separate
> adapters — they're just the `<STATION>_MODEL` value in the staffing sheet.

## 1. Run-location

- **2.x default: LOCAL** — the seat runs where its runner runs, on the local
  project (`PROJECT_PATH` from `rig.conf`); read/write/git are plain local ops.
- Remote rigs (v1-style, `SUPERMAN_HOST` set): reach the repo over SSH and
  **write repo/state files on the host over SSH**, not a local tool (same as
  Claude). Unset/`local` = none of this applies.
- Launch: `launch.sh` echoes a SAFE bare `codex` line; for engine-launched
  seats the LAUNCHER appends `--dangerously-bypass-approvals-and-sandbox` and
  ONLY inside a rendered crate wall — an unwallable codex seat REFUSES to boot
  (FLAWS "codex-seat walling", fixed 2026-07-12). Codex's own sandbox is
  Seatbelt too and cannot nest inside the wall; the wall is the containment.
  With NO `-m`, Codex uses the account's DEFAULT model —
  the robust choice. Model + reasoning-effort are Codex-CONFIG concerns
  (`~/.codex/config.toml`, e.g. `model_reasoning_effort = "high"`), NOT launch
  args. Do NOT pass a recorded display string like `gpt-5.5-high` as `-m` — it is
  not a valid model id and Codex will 400. (Re-proven live 2026-07-12:
  `-m gpt-5.5-codex` is rejected outright on ChatGPT accounts.) Leave
  `CODER_MODEL` empty in the staffing sheet unless you have a verified, valid
  `-m` id. Keep the CLI current: an outdated codex can 400 on the account's
  own default model ("requires a newer version of Codex") — `codex update`.

## Boot note — update behavior + large-paste submit

When a newer version exists, Codex may interrupt a fresh launch in ONE of two ways.
Neither is an error or a boot failure; handle deterministically and continue:
- **"Update available X -> Y" prompt** (interactive): dismiss it — send `down` then
  `enter` to choose Skip — and proceed.
- **Auto-update runs**: it prints "Updating Codex via ... install.sh", downloads,
  then "Update ran successfully! Please restart Codex" and drops back to the shell.
  Wait for it to finish, then **relaunch Codex once** with the same launch command.
  It comes up current.

This is a ONE-TIME event per release (not every boot). There is no exposed flag to
disable the check; staying current avoids it until the next release.

**Large-brief submit (attended TUI use).** A long brief pasted into the Codex TUI
directly lands as `[Pasted Content N chars]` and does NOT auto-submit — press
`enter` once more and confirm it is Working. Headless deliveries don't paste into
a TUI, so this only matters when a human drives the TUI by hand. (1.x history:
the TUI submit key was probe-verified as `enter` on codex 0.144.1, 2026-07-12,
inside a rendered wall — moot now that cmux send-keys are retired.)

## 2. Peer resolution (role keys)

Identical to the Claude adapter: peers are role keys (`orchestrator` / `coder` /
`reviewer` / `designer` / `tester`); `agentctl deliver` resolves the seat.

## 3. Report delivery (a result must REACH the orchestrator)

Deliver to a peer seat (a report printed in its own transcript reaches no one):

```
python3 .agents/bin/agentctl.py deliver <role> "<message>" --from <station>
```

Durable maildir write + unconditional wake of the target's runner; agentctl's
own `INBOX`/`QUEUED` output is the confirmation. Same rules as Claude otherwise:
verdicts/reports go through the report skill (`config/skills/report.md`), and
onboarding acks are delivered the same way.

## 4. State signal

The transition vocabulary is binder. Codex runs the emit over its SSH session from
the repo root, exactly like Claude:

```
python3 .agents/bin/agentctl.py emit <verb> --actor <station> key=value ...
```

`agentctl` validates the move, logs it to `state/events.log` (ground truth), and
advances the session state; pair the emit with a wire-3 `deliver` when a report
accompanies the signal.

## What adding a NEW agent takes (the general recipe)

1. Copy this folder to `adapters/<your-agent>/` and answer the four wires above
   for that tool (where it runs, how it reaches the repo, how it runs
   `agentctl deliver` and `agentctl emit`).
2. Give it a launch command — `launch.sh` in this folder; the app's launcher
   builds the walled seat command from it.
3. Staff a station with it in `rig.conf` (`<STATION>_AGENT=<your-agent>`).
The binder (`config/<station>.md`) never changes — that's the whole point.
