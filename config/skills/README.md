# Skills — progressive-disclosure capabilities

A **skill** is a self-contained capability the agents load ONLY when a task needs
it. This is **progressive disclosure**: the cheap part (a one-line `description`)
is always visible in the catalog; the expensive part (the full skill body) is read
only when an agent decides the skill applies.

Why it matters: every line in an always-loaded file (a binder, `AGENTS.md`,
`INDEX.md`) is a token tax on *every* request. A skill body costs **nothing** until
it's actually used. So conditional or rarely-needed knowledge belongs in a skill,
not in an always-loaded file.

## Two kinds of skill power (read this before adding any)

There are two places agent power can live. Default to the FIRST — it keeps the
engine agent-agnostic and portable:

1. **Brain skill (this folder — agent-agnostic).** A capability expressed as
   instructions any agent can follow (`markdown-audit`, `planning-artifact`, an e2e
   recipe). Travels with the ROLE/brain → whoever staffs the role inherits it
   (claude, codex, hermes…). Portable, and **role-scopeable** (a binder references
   only the skills its role needs). **This is the primary lever for making roles
   stronger over time.**
2. **Agent-native plugin (per-adapter).** A capability that CAN'T be plain
   markdown — e.g. the `frontend-design` Claude plugin. It travels with the AGENT,
   exists only for that harness, and is **declared per-agent in `adapters/<agent>/`**
   (e.g. "Designer-on-Claude → recommend frontend-design"). Use ONLY for things that
   can't be a brain skill.

Anti-pattern: piling capabilities onto Claude globally to make roles "powerful." It
works only while every station is Claude — the moment you staff Codex/Hermes, that
power vanishes. It also can't be scoped per-role. Put reusable power in the brain.
(Skill Creator is agent-native, but the skills it AUTHORS should land here, in the
brain, so they're portable + shared.)

## The contract (skill format)

Each skill is one file `config/skills/<name>.md` with frontmatter:

```
---
name: <kebab-name>
type: skill
description: <ONE line — what it does AND when to use it. This is the ONLY part
             loaded until the skill is invoked, so make it self-selecting.>
inputs:  <optional>
outputs: <optional>
side_effects: <optional — e.g. "none (read-only)">
---
# <Title>
…the full procedure, read on demand…
```

The `description` is the whole point: it must let an agent decide whether to open
the body **without** opening it. Write it as "do X when Y."

## Catalog (one-liners — bodies load on demand)

> These same one-liners live in `config/INDEX.md` so they load at boot (cheap
> discovery). Add a line here AND in INDEX when you create a skill.

- **markdown-audit** — read-only audit of the brain markdown (frontmatter
  completeness, prose efficiency, cross-reference integrity + graph shape:
  broken-reference, orphan, and hub detection across the doctrine tree).
- **planning-artifact** — present a non-trivial plan as an interactive HTML artifact
  (in the project's design system) for the human to review/annotate, instead of a
  wall of text. For feature/redesign planning; skip for trivial changes.
- **build-preview** — generate the operator's branded preview card (a QR for the
  mobile test + an "Open on this computer" desktop button, same dev route) and
  open it; for human build-testing / merge gates. Brand from rig.conf `BRAND_*`.

## When to create a skill (the extraction protocol)

Extract a skill when knowledge is **conditional or rarely needed** — it would
otherwise sit in an always-loaded file but is used only for *some* tasks (e.g.
"how to run e2e tests" — only when changing code; a specialized audit; a one-off
migration recipe).

1. Spot a conditional/rarely-needed chunk bloating an always-loaded file
   (a binder, or a project's `AGENTS.md`).
2. Move it into `config/skills/<name>.md` with a **self-selecting `description`**.
3. Leave at most a one-line pointer where it was.
4. Add the one-liner to the catalog (here **and** in `INDEX.md`).

Result: the always-loaded file shrinks; the knowledge loads only when relevant.
This is how the brain stays lean while getting smarter over time.

## Authoring tooling (optional)

- Anthropic's official **Skill Creator** skill teaches an agent to author skills
  in this format — install it when you want help generating a new one
  (Claude: `/plugin`; or the agent-agnostic `npx skills` CLI from Vercel).

## Hygiene — do NOT skip

- **Only vetted skills:** official Anthropic skills, or skills WE write/extract.
- **Never install random internet skills.** They can run anything on the host
  (API-key / credential leak risk), and many *degrade* performance — benchmarked
  cases use MORE tokens for WORSE results. **Popularity ≠ quality.** Eval before
  adopt; the eval bar is the moat (see `VISION.md`).
