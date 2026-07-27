# Adapter: Claude Code — Orchestrator ops

The coordination machinery for an orchestrator staffed by **Claude Code**. The
binder (`config/orchestrator.md`) says WHAT the four jobs accomplish and the rails;
this card is HOW a Claude orchestrator drives the headless wires to do them. The
four shared wires (peer resolution, report delivery, state signal, run-location)
are in `adapter.md` — this card adds the orchestrator-only operations. Seats are
addressed by ROLE KEY (`orchestrator` / `coder` / `reviewer` / `designer` /
`tester`); which agent fills which seat comes from the staffing sheet (`rig.conf`).

> History: this card once documented the `cmux` pane bus — surface maps, send
> hygiene, read-screen verification, pane liveness. cmux was the 1.x transport;
> retired in 2.1. Everything below is the headless doctrine that replaced it.

## Dispatching to a seat (EVERY send)

    python3 .agents/bin/agentctl.py deliver <seat> "<brief>" --from orchestrator

The delivery writes a durable maildir message AND wakes the target seat's runner
unconditionally. A delivery is VERIFIED by `agentctl`'s own `INBOX`/`QUEUED`
output — there is no screen to read back, no submit key, no liveness pre-check.
If `deliver` itself errors (bad role key, broken state dir), that error is the
finding to act on — never improvise an alternate route. Results come BACK to you
the same way: the report skill (`config/skills/report.md`) is the wire for
verdicts and reports.

## INITIALIZE machinery

0. **Batch your boot reads into ONE round-trip.** Before anything else, `cat`
   all your context files in a single shell call (one `for`-loop over `cat`),
   never one call per file: `config/orchestrator.md`, `AGENTS.md`, `PROGRESS.md`,
   `ISSUES.md`, `rig.conf`, `adapter.md`, `orchestrator-ops.md`,
   `state/session.md`. One round-trip, then read it all from that single output.
   (Same for RECOVER.)
1. Read `config/workspace.md`.
2. **Seat lifecycle is the app's, not yours.** The GUI server / teamproc (or the
   `crate` CLI) boots each seat from its adapter's `launch.sh` — correct model,
   sandbox wall, and permission posture included. You never launch a seat
   yourself; if a seat is missing, ask the human to start it from the Team menu
   (or run `crate` yourself only if your brief says the CLI is yours to drive).
3. **Write `state/session.md` immediately** (status, project, the staffing from
   `rig.conf`). Runners re-orient from state files on relaunch — this file is
   the successor's first read, so keep it current from the first minute.
4. Onboard each seat with a boot brief via `deliver`: the binder + state file to
   read, its role key, its peers' role keys, the merge-gate rule. Require a
   proof-of-read ack, delivered back the same way (a printed ack reaches no one).
5. Confirm the dev server is up (start on the host if not) — verify with
   `curl -sI <DEV_URL>/<route> | head -1` (expect 200).
5b. **Preview transport.** If `rig.conf` `PREVIEW_PROVIDER` is not `none`, bring up the
   tunnel: `.agents/bin/preview-tunnel up` (idempotent — writes the resolved
   `PREVIEW_URL` to rig.conf). The operator can then preview on phone/desktop over the
   private tunnel. Because it is idempotent it self-heals on every boot/recover; skip on
   `none` (LAN baseline).
6. **Cold start only** — `emit boot` is legal ONLY from `down`/`checkpointed`, and
   the host state machine persists across seat relaunches, so check first:
   `agentctl state`. If `down`/`checkpointed`:
   `python3 .agents/bin/agentctl.py emit boot --actor orchestrator` → state becomes
   `initialized` in `state/events.log`. If the state is already live (seats
   relaunched on a persisted state machine), SKIP this — `emit boot` would be
   REJECTED and would fake a reset; preserve the live state (the RECOVER path).
7. Update `state/session.md` (status=live) and mirror `agentctl state`.

If one seat dies, have it relaunched (app Team menu / `crate relaunch <seat>`);
its runner re-orients from its state file — then `deliver` it a short resume
brief.

## RECOVER machinery

First read the timeline: `agentctl state`, `agentctl tail 20`,
`state/checkpoints/CHECKPOINT-latest.md`, each `state/<station>.md`. Seats are
relaunched by the app; runners re-orient from state files. When onboarding each
seat (INITIALIZE step 4), append its resume context: "...session state is
<state>; you left off: <Now/Next from its state file>. Resume there." Do NOT
re-emit `boot` if the log already shows a live state — recovery resumes, it does
not reset.

## Handoff machinery (.recover / .handoff successor handover)

`config/procedures/recovery.md` owns the WHAT + the safety invariant. Headless,
the mechanics collapse — there is no successor-seat dance:

1. Write CHECKPOINT first (below), and make sure `state/session.md` reflects NOW.
2. The orchestrator seat is relaunched by the app (Team menu / `crate relaunch
   orchestrator`) — ask the human, or run the CLI if your brief grants it. Seats
   never relaunch themselves or each other by hand.
3. The fresh runner re-orients from `state/session.md`,
   `state/checkpoints/CHECKPOINT-latest.md`, and `state/events.log`, announces
   itself primary in the chat thread, and resumes.

(The 1.x cmux A→B two-pane handover — `new-pane`, the "successor ready" wait,
the surface-renumber close footgun — is retired history.)

**Worker rebuild** (.recover / .resume — NOT done in .handoff): for each of the
four workers, relaunch fresh with the ENGINE's revive — `crate relaunch <seat>`
(from the project root, or add `--project <path>`). It exits a still-running
harness and relaunches the seat with the launcher-built command — sandbox wall
and permission posture included. **Never hand-type an adapter launch line**
(e.g. a bare `claude --model opus`): that boots the seat UNWALLED and in the
wrong permission mode (run #12 finding). Then `deliver` each a re-brief to read
its own `.agents/config/<role>.md` + state from disk and require a proof-of-read
ack. Relaunch is the only thing that both clears context AND guarantees the
model/wall — never keep a live seat to "save time."

## CHECKPOINT machinery

0. **Capture baseline mtimes FIRST** — before broadcasting, record each
   `state/<station>.md` mtime (e.g. `stat -c %Y`). Fast agents may write within
   a second of the broadcast, so a baseline captured *after* the broadcast races
   them and falsely marks freshly-written files "stale". Baseline must predate
   the broadcast.
1. Broadcast to each working seat:
   `python3 .agents/bin/agentctl.py deliver <seat> "CHECKPOINT: write your
   status to .agents/state/<you>.md now (status, Now, Next, Blockers). Reply
   'checkpoint done'." --from orchestrator`
2. Confirm each wrote: its `state/<station>.md` mtime is now NEWER than the
   step-0 baseline (or it replied "checkpoint done"). Compare against the baseline,
   never against a timestamp captured after the broadcast.
3. Read every `state/<station>.md`, plus `agentctl state` and `agentctl tail 30`,
   plus the full `state/retries.yaml`.
4. Write `state/checkpoints/CHECKPOINT-latest.md` (aggregated; include current
   state, the recent timeline, and the full `state/retries.yaml`); copy to
   `state/checkpoints/archive/<YYYY-MM-DD-HHMM>.md`.
5. `python3 .agents/bin/agentctl.py emit checkpoint --actor orchestrator`
   (always-legal, non-advancing). Update `state/session.md` last-checkpoint pointer.

## .status machinery

Read-only — deliver nothing, emit nothing. Gather: `agentctl state`; `agentctl
tail 5`; each `state/<station>.md`. Seat liveness is read from the app's Team
menu / the `crate` CLI — never by prodding a seat with a message. Report the
compact table. Never emit, never write a file.

## Backstop watcher (close every loop)

The watcher ships in the box: `.agents/bin/rig-wait.sh` (run #14: don't improvise
an inline poller — it's already here). Run it FROM THE PROJECT ROOT via the Bash
tool with `run_in_background:true`. Two modes:

- **State backstop** (after dispatching the Coder):
  `bash .agents/bin/rig-wait.sh <baseline-state>` — baseline = the CURRENT
  `agentctl` state; it exits printing `CHANGED: <state>` the instant the state
  machine leaves baseline, and the harness re-invokes you with that output.
- **Verdict join** (after the parallel Review + QA dispatch — they report, they
  don't transition): `bash .agents/bin/rig-wait.sh --files reviewer,tester` —
  captures both state-file mtimes at launch and exits `ALL-REPORTED` once BOTH
  have written (they update their state file right before reporting).

The `code_ready` emit PINS the Coder's sha (`state/pin-code_ready`; the signal
line carries `sha=`). Put that sha in both the Review and QA dispatch briefs —
both lenses verify the SAME frozen commit — and your `approved` join is
mechanically REJECTED by agentctl if the branch tip moved after the pin (run
#14). On that rejection: emit `changes_needed`, have the Coder finalize one
commit and re-emit `code_ready` (re-pins), re-run both lenses.

Deliveries are durable (maildir + unconditional runner wake), so a station's
pushed report cannot stall the way a 1.x busy-pane send could. Still, a report
is the station's WORD; the deterministic completion signals are the STATE
MACHINE (the station's `agentctl` emit) and this backstop's wake — after
dispatching, lean on those and on the state files, and read `agentctl tail` /
`state/events.log` (ground truth) rather than pinging seats for status.

## Context monitor

Retired with cmux: the 1.x "rigctx" status chip (`rig-ctx.sh` /
`rig-ctx-watch.sh`) was cmux UI. Headless, per-seat status is the app's to
surface (Team menu); escalate context/health concerns to the human via the chat
thread.

## Operational gotchas

- **Provider 5xx ("Overloaded" 429/529) is NOT a rig fault — never poll-loop on it.**
  If a seat reports (or the app shows) sustained API retry/backoff (more than ~2
  cycles), do NOT keep sleeping + re-checking it for minutes. Record the station
  as "dispatched, ack delayed by provider <code>, auto-retrying", move on with
  the rest of the boot/dispatch, and surface it ONCE in your report. The seat
  retries on its own — re-check on your next natural turn, not in a tight wait
  loop. Cap any single wait at ~30s.
- **`deliver` takes the message as ONE shell-quoted argument.** Keep briefs
  plain prose; anything long or structured belongs in a file the seat is told
  to read.
- **Never run a production build against the live dev repo.** `npm run dev` (:3000)
  and `npm run build` share the same `.next` in the working tree; a build while dev
  is live corrupts the dev chunks → HTTP 500 (`Cannot find module './NNN.js'`). To
  check a branch compiles: trust the dev hot-compile + a route-200 check, build into
  a separate distDir, or let the coder report its build result. If `.next` is
  corrupted or a route 500s: `.agents/bin/dev-server restart` (clean supervised relaunch)
  — NEVER a broad `pkill -f "next dev"`, which kills EVERY rig's dev server on the host.
  See `config/procedures/dev-server.md` (supervised, isolated, memory-bounded per repo).
- Dev server cold-compiles the first hit (~9s) — warm it with a `curl` before
  opening in a browser.
