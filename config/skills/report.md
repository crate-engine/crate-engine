---
name: report
type: skill
description: Deliver a report, ack, or verdict to another station — REQUIRED whenever your binder says a result must REACH the orchestrator (a report printed in your own transcript reaches no one). Covers composing the message, delivering it durably, and confirming it queued.
inputs: the message; the target role (almost always the orchestrator)
outputs: the message queued in the target's inbox, delivery confirmed
side_effects: appends to state/inbox files; no code changes
---

# report — the report wire (wire 3)

Your result is DONE only when it reaches the target station. Printed text
reaches no one. Follow these steps exactly.

## 0. State file first

Before delivering any report/verdict, write your own `.agents/state/<role>.md` via bash (the FULL .agents/ prefix — a bare state/ lands in the wrong place)
(status, what you did, verdict, open concerns). This is in-protocol for EVERY seat,
including read-only ones — read-only is a law about the CODE, not your state file.

## 1. Compose a safe message

- One message, plain prose. **No backticks, no `$( )`** — you run the deliver
  command through a shell, and either would be EXECUTED locally and corrupt
  (or leak into) the message.
- Lead with the signal tag + data: `[APPROVED] branch=... commit=...` /
  `[BUGS_FOUND] branch=... | 1) ... 2) ...` / `[ACK] <role> station booted ...`.
- Keep it under ~10 lines; long bodies go in a file, send the pointer.

## 2. Deliver — one command, durable by construction

    python3 .agents/bin/agentctl.py deliver <role> --from <your-role> "<message>"

That writes TWO things, atomically:
- `state/inbox/<role>.md` — the append-only human audit trail.
- `state/inbox/<role>/new/<msg>` — the maildir queue entry the target's
  runner WAKES on. The file IS the delivery: it cannot be lost, replaced,
  or missed while the target is busy (it sits in new/ until the target's
  next turn processes it — at-least-once, D11).

ALWAYS sign with `--from <your-role>` — unsigned messages read as the
operator and pollute the human's chat thread.

## 3. Confirm it queued (do not skip)

The command's own output is the receipt. You must see BOTH lines:

    INBOX: recorded for <role> (state/inbox/<role>.md) — the durable copy.
    QUEUED: <role>'s runner wakes on it (state/inbox/<role>/new/<file>).

If the command errored or the QUEUED line is missing (and the target is not
`operator` — the operator has no runner, INBOX alone is complete), the
delivery did NOT happen: say so in your state file and STOP — a silently-lost
report is the worst outcome. Never end a task without delivering.

## Rules

- Verdicts go to the ORCHESTRATOR only — never signal the coder directly.
- State-machine handoffs (`agentctl.py emit <handoff>`) queue their signal to
  the target seat automatically — emit for the STATE MACHINE, deliver for
  everything with a body (reports, acks, file plans, verdict detail).
- Deliver, then go idle. One report per completion; no chatty follow-ups.
