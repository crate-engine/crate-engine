# Escalation Log

Per-project durable history of Rung-2+ escalation events.
Append one row per event. Insights feed brain updates via normal loops.

| Date       | Task              | Defect Signature              | Attempts | Diagnosis Source | Surgical Fix Summary | Outcome         |
|------------|-------------------|-------------------------------|----------|------------------|----------------------|-----------------|
| —          | —                 | —                             | —        | —                | —                    | —               |

## Insights

Recurring patterns observed across escalations. Periodically feed into
brain `config/coder.md` updates via a normal pipeline loop.

<!-- Example entries (remove in live use):
| 2026-06-19 | phase-5.2-autosave | form.watch → scheduleSave never fires | 3 | Opus diagnostic subagent | Replaced watch with useRef + manual trigger in useAutosavedForm.ts | surgical_applied → approved |
| 2026-06-20 | stripe-webhook    | 400 on idempotency replay       | 4 | Opus diagnostic subagent | Added idempotency-key header generation | escalated to Adam (whack-a-mole guard) |

## Insights
- The coder tends to skip null checks in async handlers. Consider adding a
  pre-review checklist item for promise chains with no .catch().
- A weaker coder model missed root causes on 3 of 4 diagnostics; a stronger
  diagnostic subagent identified the real bug each time. Rung 2 diagnostic rule is validated.
-->
