# session.md — {{PROJECT}} dashboard

> ALWAYS-LOADED. The orchestrator is the SINGLE writer; it updates this at every
> checkpoint (never ad hoc). The "stable story" below is safe to trust. The
> VERIFY-LIVE facts are RE-CHECKED on spin-up and never trusted from this file —
> that rule is what keeps the dashboard from drifting out of sync with reality.

updated: <YYYY-MM-DD HH:MM>          # stamp every edit
last-checkpoint: state/checkpoints/CHECKPOINT-latest.md
state: idle                          # mirror of agentctl; events.log is authoritative

## Where we are (STABLE — changes only when we decide)
- Current focus: <task>
- Last shipped: <summary>
- Next: <next step>

## VERIFY-LIVE on spin-up (do NOT trust the values here — re-check, then refresh + stamp)
- code version:  git -C {{PROJECT_PATH}} rev-parse --short HEAD
- dev server:    curl -sI {{DEV_URL}}   (expect 200)
- team status:   check each seat's state/<role>.md + the app's Team menu

## services
# (dev server, monitors, etc. — with "as of" stamps)

## Pointers
- Known issues / improvements noticed: state/FLAWS.md
- Station->orchestrator deliveries: state/inbox/ (maildir new/ = unprocessed)
