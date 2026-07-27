# Skill: deep-quality review ([DEEP_REVIEW] dispatches only)

> The Reviewer's DEEP mode: a structural-maintainability audit on top of the
> normal correctness pass. Read this card ONLY when your dispatch carries
> `[DEEP_REVIEW]` — standard reviews never pay this cost. Inspired by Mat
> Paddock's "thermo-nuclear code quality review" (cursor-team-kit); the
> doctrine below is Crate Engine's own.
>
> **Severity translation is LAW.** In a NORMAL loop that got auto-escalated
> (mechanical signals), structural findings land as **SHOULD-FIX tagged
> `[quality]`** — the human judges them at the gate, and any finding bigger
> than the brief becomes a PROPOSED follow-up loop via the orchestrator, never
> an in-loop demand on the coder. Only in an EXPLICIT deep/refactor loop (the
> human asked for a quality audit) do this card's approval standards block.

## The posture

Correct behavior alone is not the ceiling. Hunt the restructuring that keeps
behavior identical while deleting complexity — the move that makes branches,
helpers, modes, or layers VANISH rather than get rearranged. Prefer one
high-conviction structural finding over a page of nits.

## The audit standards

1. **Simplification ambition.** For each meaningful change ask: is there a
   reframing that deletes a whole category of complexity? Flag refactors that
   move complexity around without reducing it.
2. **File-size boundary.** A file the diff pushes from under to over the
   boundary (default 1000 lines; AGENTS.md Review Standards may tune it) is a
   structural smell — ask for extraction unless the size is structurally
   earned. Pre-existing oversized files are context, not this PR's crime.
3. **Branch growth.** New ad-hoc conditionals bolted into unrelated flows,
   one-off booleans/nullable modes, special cases scattered across shared
   paths — ask for the dedicated abstraction, state model, or module instead.
4. **Abstractions earn their keep.** Thin wrappers, pass-through helpers, and
   "generic" machinery hiding one simple assumption add indirection without
   clarity — prefer the direct flow. Equally: copy-pasted logic and bespoke
   near-duplicates of existing canonical helpers get pointed at the canon.
5. **Types and boundaries.** Unjustified casts, `any`/`unknown`, optionality
   that muddies a contract, silent fallbacks hiding real invariants — ask for
   the explicit model.
6. **Canonical layers.** Feature logic leaking into shared paths, or
   implementation detail crossing an API boundary, belongs in its rightful
   home — name the home.
7. **Orchestration shape.** Needless serialization of independent work, and
   partial-update flows that could be atomic, are complexity too — flag them
   without inventing premature optimization.

## Output

Order findings structural-first: (1) structural regressions, (2) missed
dramatic simplifications, (3) branch/spaghetti growth, (4) boundary/type
contracts, (5) file size, (6) legibility. Tag every finding `[quality]` plus
the normal severity tier. State each as the concrete move ("extract X",
"reframe Y so these branches disappear", "reuse canonical Z"), not as vibes.
Direct and demanding, never rude. Cap the list at the findings you would
personally insist on — no nit floods.

## Approval standard (EXPLICIT deep/refactor loops only)

Hold `[APPROVED]` when the change adds a structural regression a clear path
avoids: a plausible simplification ignored, an unearned boundary crossing, a
file-size explosion, scattered special-casing, wrapper/cast churn, or
duplicated canon. Justified exceptions pass — demand the justification, not
perfection. In auto-escalated normal loops this paragraph does NOT apply
(severity translation above).
