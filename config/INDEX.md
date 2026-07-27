# Agent Brain — Map

| Station | Binder | Role | Staffed by |
|---------|--------|------|------------|
| Orchestrator | config/orchestrator.md | Coordination + routing | see `.agents/rig.conf` |
| Coder | config/coder.md | Implementation | see `.agents/rig.conf` |
| Reviewer | config/reviewer.md | Code review | see `.agents/rig.conf` |
| Designer | config/designer.md | UI/UX | see `.agents/rig.conf` |
| QA Tester | config/tester.md | Runtime testing | see `.agents/rig.conf` |

> The "Staffed by" column is **staffing** for THIS rig (which agent fills which
> station), not the product. The portable product is the three layers: the
> **binder** (`config/` station missions, agent-neutral), the **staffing sheet**
> (`rig.conf`), and the **adapters** (`adapters/`). See `adapters/README.md`.

## Where things live
- Legal state transitions: config/state-machine.yaml
- Handoff signals: config/handoff-protocol.md + config/handoffs.yaml
- Procedures (commit-verify, design-lock-preview, pre-review-checks, recovery, escalation-ladder, dev-server): config/procedures/
- Standards (markdown audit, code style, git flow): config/standards/
- Skills (progressive disclosure — load a skill BODY only when you invoke it; format + creation protocol in config/skills/README.md):
    - markdown-audit — read-only audit of the brain markdown (frontmatter, prose efficiency, cross-refs + graph shape: broken-ref/orphan/hub)
    - planning-artifact — present a non-trivial plan as an interactive HTML artifact (project design system) for review/annotation, vs a wall of text
    - build-preview — branded preview card (QR mobile + desktop button, same dev route) for the human to test a build; brand from rig.conf BRAND_*
    - qa-method — the QA station's run recipe (sweep → intent test → console-after-every-action → error paths → verdict); MANDATORY on every QA run
    - design-method — the Designer station's design-lock run recipe
    - report — how a station delivers reports/verdicts durably (agentctl deliver: inbox record + runner wake)
- Agent adapters (the four shared wires — run-location, peer resolution, report delivery, state-signal invocation): adapters/<agent>/  ← Layer-3 mechanics, kept OUT of the binder. Present: pi/, claude/, codex/, opencode/, aider/, gemini/, openclaw/.
- Session status mirror (for humans + checkpoints): state/session.md
- Current state: state/events.log  ← last line's state= is current
- Retry/escalation counters: state/retries.yaml
- Escalation history + insights: state/ESCALATION-LOG.md

## Boot (lazy): read your binder + this INDEX; open a procedures/ file only when you run that procedure.
