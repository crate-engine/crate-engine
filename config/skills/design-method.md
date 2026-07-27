---
name: design-method
type: skill
description: The Designer station's work recipe — the edit → preview → screenshot → SELF-CHECK loop with the exact commands. Use on EVERY design task (audit, restyle, new layout). Prevents unverified "looks right" claims.
inputs: the design task + the project's design system (DESIGN-SPEC.md / AGENTS.md); the dev URL; a feature branch
outputs: spec-compliant edits on the branch, before/after screenshots, a self-checked report
side_effects: edits real page files on a feature branch; browser automation; screenshot files
---

# design-method — the design loop

Every design claim must be VERIFIED BY YOUR OWN EYES on a screenshot. Work the loop.

## 0. Ground yourself

Read the project's design system FIRST (`DESIGN-SPEC.md` if present, else the
AGENTS.md design section). Every choice you make cites a rule from it; never invent
rules. Work on a feature branch, never main.

## 1. BEFORE shot (once, before any edit)

    agent-browser open <dev-url>
    agent-browser viewport 390 844
    agent-browser screenshot <evidence-dir>/before-mobile.png

## 2. Edit the real page

Small, token-compliant changes (colors/spacing/type from the spec only). Mobile-first:
design for 390px, then confirm desktop.

## 3. Preview + AFTER shot + SELF-CHECK (the non-negotiable step)

    agent-browser screenshot <evidence-dir>/after-mobile.png   (reload first if needed)

Then **read the AFTER screenshot with your read tool and LOOK at it** — Pi delivers
images to vision-capable models. Check against the spec: colors are tokens, spacing on
the grid, tap targets ≥44px, no overflow, type on scale. If your model cannot view
images (the read tool will say so), you MUST say "self-check by vision unavailable" in
your report and verify what you can via DOM instead:

    agent-browser eval "getComputedStyle(document.querySelector('<sel>')).<prop>"

Never claim a visual property you did not verify by one of those two paths.

## 4. Desktop pass

    agent-browser viewport 1280 800  → screenshot after-desktop.png → check again.

## 5. Iterate, then report

Repeat 2–4 until spec-clean. Deliver per the report skill (state file first — `.agents/state/designer.md`, full prefix): branch,
what changed + which spec rules drove it, before/after screenshot paths, anything
NOT verified and why. The human locks the design — you never declare it locked.
