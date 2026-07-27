# Recovery Procedures — .recover / .resume / .handoff

**Extracted from:** `config/orchestrator.md` — LOOP A brain hardening

This binder describes the doctrine for the three recovery commands: WHAT happens,
in what order, and the safety rails. Since T8 the team is HEADLESS: seat
lifecycle (spawn/stop/relaunch) belongs to the APP (`crate open` / the Team
menu / `crate team`), runners are supervised children, and every runner
re-orients itself from state files on each turn — so recovery is about the
STATE being safe and authoritative, not about hand-choreographing seats.

> **"Seat"** = one agent's supervised runner. The app's Team menu shows all
> five; per-seat **Relaunch** restarts exactly one; **Boot/Resume** restarts
> the team. A relaunched runner knows only what the state files tell it —
> fresh context is the default, not a procedure.

---

## .recover

**Full fresh restart of the ENTIRE rig — orchestrator included. Writes a
checkpoint, then the team is relaunched; everyone re-orients from the
checkpoint. Continues from the checkpoint; does NOT reset the work state.**

On `.recover`, the orchestrator:

1. Runs the `.checkpoint` procedure first (Job 3). CONFIRM the snapshot was
   written before anything is relaunched — the checkpoint IS the handoff.
2. Reports to the human: "checkpoint written — relaunch the team (app Team
   menu → Boot/Resume, or `crate open`)." The APP relaunches seats; no agent
   spawns or closes another agent's runner.
3. After relaunch, the (fresh) orchestrator treats disk as the only truth:
   read `CHECKPOINT-latest.md` + `state/session.md` + tail `events.log` +
   `state/retries.yaml`; confirm the last state before acting.
3b. **Restore retry/escalation state.** If `state/retries.yaml` is MISSING,
    extract its contents from the `CHECKPOINT-latest.md` snapshot (step 1
    captured it) and write `state/retries.yaml`. This is what makes retry
    counts and escalation state survive a full rig rebuild. If the checkpoint
    has no retries.yaml section (pre-D brain), seed a fresh empty one from
    `templates/state/retries.yaml`.
4. State stays as checkpointed — a recover never advances or resets the work
   state (no boot event unless the state is genuinely `down`/`checkpointed`
   and the cold-start law in Job 1 applies).
5. Report: current state + per-worker status + "recovered from checkpoint,
   ready."

SAFETY INVARIANT: nothing is relaunched until the checkpoint snapshot is
confirmed on disk. The supervisor guarantees a live orchestrator runner after
relaunch; there is no window where un-checkpointed session memory is the only
copy of anything (state files are written as work happens — session memory is
never load-bearing).

---

## .resume

**Cold start for a NEW day (machine slept, app closed and reopened). NOT a
checkpoint — last night's checkpoint is the save.**

On `.resume`, the orchestrator:
1. Treats the on-disk checkpoint + session.md + events.log + retries.yaml as
   source of truth (NOT session memory). Read them; confirm the last state and
   retry/escalation counters.
2. Does NOT write a new checkpoint. Workers need no rebuild ritual: every
   runner turn starts from a fresh context assembled from state files by
   construction — there is no stale session memory to purge.
3. State stays idle — resume does not advance or reset state (no boot event).
4. Report: current state + where we left off (last shipped / Now·Next from the
   checkpoint) + "resumed, ready."

---

## .handoff

**Orchestrator-only refresh. Relaunch exactly the orchestrator's seat (app
Team menu → Relaunch on the orchestrator; auto-revive uses the same path);
the four workers stay live and untouched.** Use when the orchestrator's
context is climbing but the rig is otherwise healthy.

1. Run `.checkpoint` first and confirm the snapshot (same law as .recover —
   the checkpoint is the handoff).
2. Ask the human to relaunch the orchestrator seat from the Team menu.
3. The fresh orchestrator re-orients from disk (checkpoint + session.md +
   events.log + retries.yaml) and reports: state + workers untouched +
   "orchestrator refreshed, workers live, ready."

Taxonomy: .resume = new-day cold start (nothing rebuilt; disk is truth).
.handoff = orchestrator-only relaunch. .recover = checkpoint + whole-team
relaunch.
