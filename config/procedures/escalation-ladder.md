# Escalation Ladder

Applies after QA returns a defect (orchestrator already waits for BOTH
Reviewer + QA; QA is decisive).

## Rung 1 — Same defect, attempt 1
Consolidate Reviewer + QA findings into ONE specific brief. Relay to the coder.

## Rung 2 — Same defect, 2nd failure (same_defect_streak == 2)
STOP symptom-briefing. Do NOT relay "try again."
1. Spawn a strong diagnostic subagent to root-cause (a coder stuck on the same defect twice needs a fresh root-cause, not a third try).
2. From the diagnosis write a SURGICAL spec for the coder:
   Problem (1 sentence) · Location (file + lines) · Current wrong behavior ·
   Correct behavior · Exact before→after edit · Why it works.
3. Relay the surgical spec. Require a runtime-verify checklist back from the coder
   BEFORE re-dispatching to review.
Set escalation_state: diagnosing → surgical_applied.

## Rung 3 — Still failing after the surgical fix
Escalate to the human. Do NOT keep looping. Report: defect, what was tried, the
diagnosis, recommended next step. Set escalation_state: human.

## Whack-a-mole guard (new regression each round)
If defects differ each round (streak stays 1) but total_rounds reaches 4,
escalate to the human anyway — a moving target is its own failure mode.

## Always
Data-loss / safety defects: always fix, never ship (existing rail, unchanged).
Log every Rung-2+ event to state/ESCALATION-LOG.md.
