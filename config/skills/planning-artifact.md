---
name: planning-artifact
type: skill
description: When planning a non-trivial change that has OPTIONS or design decisions to weigh, present the plan as an interactive HTML artifact (in the project's design system) for the human to review and annotate — instead of a wall of text. Use for feature/redesign planning; skip for trivial or single-path changes.
inputs: the task + the project's design tokens/system
outputs: a self-contained HTML artifact opened in the browser; the human's decisions fed back
side_effects: writes one HTML file under state/ (or a scratch path); no source changes
---

# Planning artifact (interactive plan, not a wall of text)

For a non-trivial change with options or product decisions, a markdown "wall of
text" plan is hard to read, hard to point at, and gets re-emitted (and re-read)
every round — a token + clarity tax. Instead, present the plan **visually** and let
the human **decide on the artifact**.

## When to use
- New feature, redesign, or any change where you'd otherwise list 2+ options or ask
  the human to choose between approaches.
- NOT for trivial / single-path changes — a one-line plan is fine there. Don't
  over-produce artifacts.

## How
1. Draft the options/proposal as usual (internally).
2. Generate ONE self-contained HTML file that lays them out visually — **use the
   project's own design system / tokens** (read them from the repo) so it looks like
   the real product, not a generic page. Each option/decision is a clearly labeled
   block; include a short "decisions needed" section at the bottom.
3. Open it in the browser per your adapter's browser tooling (e.g. the dev URL or a
   local file open). Screenshot it and self-check before showing the human.
4. The human reviews, annotates, and picks options **on the artifact**; capture
   those decisions and proceed to build from them.

## Why it helps
- One artifact the human reads once + annotates, vs. walls of text re-emitted each
  round → fewer tokens, fewer clarification loops.
- Front-loads clarity: requirements get pinned in planning, so the build phase runs
  with little back-and-forth.

Keep the artifact disposable (write under `state/`); it's a planning aid, not a
deliverable.
