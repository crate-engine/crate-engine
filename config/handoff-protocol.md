# Handoff Protocol — {{PROJECT}}

Handoffs are DATA, not prose: see `config/handoffs.yaml`. You don't hand-type
signals — you run `agentctl`, which validates the move, logs it, advances the
session state, and prints the exact delivery command for the target pane.

## How to perform any handoff

From the repo root, run:
    python3 .agents/bin/agentctl.py emit <handoff> --actor <you> key=value ...
Example (the coder finished a build):
    python3 .agents/bin/agentctl.py emit code_ready --actor coder branch=feature/x commit="impl how-it-works" summary="redesign done"

`agentctl` will:
  1. Check the move is legal from the current state (`state-machine.yaml`). If not,
     it logs a REJECTED event and refuses — e.g. you cannot emit `deployed` unless
     the state is `approved`. This is the guardrail; trust it.
  2. Append the event to `state/events.log` and advance the session state.
  3. Print the command(s) to deliver the signal to the target pane.

## Delivering the signal

Deliver the printed signal through **your adapter's reporting channel**:
  - A station that drives the coordination bus (the workstation stations) runs the
    printed delivery line itself.
  - A station that cannot drive the bus (a host-run coder) has already had the
    event logged and the state advanced — it asks the orchestrator to relay the
    printed lines (and also reports via its inbox + push, per its adapter).

Always also update your own `state/<you>.md` after a handoff (status, Now, Next).

## Handoff reference (mirrors `config/handoffs.yaml` — plus [MERGE], which the ENGINE routes mechanically on `gate_release`; it is hardcoded in agentctl, never hand-sent)

| handoff        | from -> to               | signal           | when                          |
|----------------|--------------------------|------------------|-------------------------------|
| design_locked  | designer -> coder        | [DESIGN_LOCKED]  | design ready to SHOW — the orchestrator's preview + the human's confirm gate the build, not this emit (CE-145) |
| code_ready     | coder -> reviewer+QA     | [CODE_READY]     | impl pushed to feature branch; fans out to BOTH verifiers |
| verdict        | reviewer/QA -> orchestrator | [VERDICT]     | a verifier's recorded verdict (`result=approve\|reject report="..."`) — records AND mails in one emit |
| changes_needed | orchestrator -> coder    | [CHANGES_NEEDED] | review or QA failed; orchestrator emits ONE consolidated list |
| approved       | orchestrator (the JOIN)  | [APPROVED]       | BOTH verdicts on record + green -- orchestrator emits the join, then holds for the human's go |
| merge          | engine -> coder          | [MERGE]          | the human's go -- the operator's `gate_release` emit mails the coder mechanically (hardcoded in agentctl; NEVER hand-sent) |
| deployed       | coder -> orchestrator    | [DEPLOYED]       | merged to main, auto-deployed |
| bugs_found     | tester -> orchestrator   | [BUGS_FOUND]     | functional bug found          |
| fix_ready      | coder -> reviewer        | [FIX_READY]      | fix pushed to branch          |
| retest         | coder -> tester          | [RETEST]         | fix deployed, confirm it      |
| verified       | tester -> orchestrator   | [VERIFIED]       | fix confirmed on deploy       |
| rollback       | orchestrator -> coder    | [ROLLBACK]       | a merge turned out bad BEFORE close — revert/fix on a branch, full loop again |

TIERING (2026-07-25): the orchestrator may declare `tier=chore|bug|feature` on
`start_impl` (omitted = full feature-shaped loop). agentctl routes `code_ready`
by the tier's MEANING: an effective **chore** (small, no tripwires, gate-passed)
mails the ORCHESTRATOR alone — no review/QA fan-out; the wall + the human merge
gate verify it. Escalation floors force a mis-guessed chore up to bug-tier
verification automatically (`TIER_ESCALATED` in the log). The merge gate is
universal — every tier waits for the human's "merge go".

In a PARALLEL review+QA loop the Reviewer and QA each RECORD a verdict
(`emit verdict --actor <you> result=approve|reject report="..."` — logged AND
mailed to the orchestrator in one move), and the orchestrator emits the SINGLE
joined transition (`approved` if both green, else ONE consolidated
`changes_needed`). THE JOIN IS PHYSICS (2026-07-24): agentctl refuses
`approved`/`changes_needed` from a verifier, and with rig.conf `JOIN_ENFORCE=1`
refuses them until BOTH verdicts are on record since the last `code_ready`.
In a TEST-LED loop QA emits `bugs_found`/`verified` itself.

[MERGE] is a MECHANICAL gate_release→coder route (2026-08-11), never hand-sent:
when the operator emits `gate_release` (GUI gate card or CLI, same route) on an
armed gate, agentctl itself queues the merge order to the coder — maildir wake
plus the `state/inbox/coder.md` mirror. It advances no state (the coder's
subsequent `deployed` emit does); a repeat release is absorbed
(`GATE_RELEASE_ABSORBED`), and a hand-sent duplicate `[MERGE]` via `deliver` is
absorbed when the order is provably already on file. Orchestrator: do NOT relay
`[MERGE]`. `approved` prints no delivery line.

## State sequence (enforced by agentctl)

  initialized -> designing -> design_locked -> implementing -> code_ready
              -> approved -> deployed -> idle
  (changes_needed loops code_ready -> implementing)
  test-led:   testing -> implementing -> code_ready -> approved -> deployed
              -> testing (retest) -> idle
  abandon:    any mid-flight state -> idle (P4-13; ORCHESTRATOR-only, no merge,
              reason recorded — the clean drop for a killed/blocked feature)
  rollback:   deployed -> implementing (bad merge caught before close; the
              revert goes back through the FULL loop — mirror of reopen)
  research:   start_research (idle/initialized/deployed -> researching) ->
              research_done -> idle (a SPIKE: explore with no merge intent,
              on the books instead of masquerading as idle; findings ->
              state files / LESSONS.md; any build after it is a NEW loop)
You cannot skip a step; agentctl enforces the arrows above.
