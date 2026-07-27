# AGENTS.md — {{PROJECT}}

> **Fill me in.** This is the project context doc that every agent reads on spin-up.
> The ORCHESTRATOR owns this file: it fills it on the first work direction
> (bootstrap interview — codebase scan first, one operator question round) and
> accrues proven knowledge at every close (knowledge flywheel, orchestrator.md).
> Delete this banner and the placeholder text in each section once filled.

## Conventions & Tech Stack

<!--
  Language, framework, package manager, build tooling, runtime.
  Example:
    - Next.js 14 (App Router), TypeScript strict, Tailwind CSS v3
    - npm (not pnpm/yarn), Node 20+
    - Build: `npm run build`, Typecheck: `npm run type-check` (tsc --noEmit)
    - Lint: `npm run lint` (next lint)
    - Dev server: `npm run dev` (port 3000)
-->

## Build & Test Commands

<!--
  Exact commands agents run to verify their work before committing.
  The `- Test:` line is LOAD-BEARING: the build gate (nm-gate) runs that exact
  backticked command as its test rung. Write `- Test: none` (or omit the line)
  for a project with no test runner — the rung stays silent; the gate never
  invents test infra.
  Example:
    - Lint: `npm run lint`
    - Type-check: `npm run type-check`
    - Build: `npm run build`   (CAUTION: never run against live dev .next)
    - Test: `npm test` or `pytest` or `python -m pytest tests/`
    - Dev: `npm run dev`
-->

## Design System

<!--
  Colors, typography, spacing, border-radius convention, component patterns.
  Example:
    - Primary: #E55125 (orange), Surface: #111111, Black: #000000
    - Font: system sans-serif, headings bold/extrabold
    - Cards: sharp (rounded-none), buttons: sharp, dots: rounded-full
    - Responsive: mobile-first, breakpoints at sm(640), lg(1024), xl(1280)
-->

## Guardrails

<!--
  What agents may do solo vs. what requires approval.
  Example:
    - Solo: implement, lint, type-check, commit, push feature branch, open PR
    - Approval required: merge to main, force-push, delete branches, deploy to production
    - Destructive ops (rm -rf, git reset --hard, database mutations): confirm first
-->

## Review Standards

<!--
  What the Reviewer checks on every code_ready branch.
  Categories and severity levels (🚨 CRITICAL, 🔴 High, 🟡 POLISH).
  Example:
    - TypeScript: no `any` types unless justified
    - Accessibility: alt text, ARIA labels, keyboard navigation
    - Responsive: mobile (375px), tablet (768px), desktop (1024px+)
    - Performance: no unnecessary re-renders, images optimized
    - Console: no errors or warnings in dev or production builds
    - Documentation: PROGRESS.md and ISSUES.md updated every step
-->

## Smoke Rung

<!--
  Tunes the gate's runtime smoke rung (PDR dev/pdr/runtime-smoke-rung.md).
  EXACTLY two tunables — routes are NOT configurable here: the rung reads
  "## Critical Paths" below (one list, two consumers: QA judges the
  assertions, the rung drives the parseable routes GET-only). Example:
    - Console allowlist: analytics.js blocked, third-party-widget
    - Ready deadline: 90
-->

## Tier Floors

<!--
  Tunes the workflow-tiering escalation floors (agentctl's tier router;
  defaults live in the engine — list lines EXTEND the defaults, they never
  replace them). All matching is dumb substring, on purpose: a false positive
  costs one shrugged verify round. Example:
    - Chore diff ceiling: 40
    - Chore file ceiling: 3
    - Protected paths: crons/, jobs/
    - Design surface: emails/, templates/   (styled emails ARE design surface in some products)
    - Generated paths: generated/, __snapshots__/
-->

## Doc Discipline

<!--
  Rules for documentation updates. Example:
    - Update PROGRESS.md after every meaningful piece of work (date, summary, files changed, decisions)
    - Update ISSUES.md when resolving a queued item or raising a new blocker
    - Code and docs land in the SAME commit for feature/refactor steps
    - Standalone doc closeouts are the only exception
-->

## Critical Paths (QA test list)

<!--
  The QA/Tester drives these flows on every code_ready branch.
  List exact routes, forms, and expected behaviors.
  Example:
    1. Homepage (/) — loads, hero renders, nav links work
    2. Browse Inventory (/browse-inventory) — car grid renders, filters work, sort changes results, card links navigate to detail
    3. Car Detail (/browse-inventory/REF) — gallery renders, quote form submits, grade legend opens
    4. Import Calculator (/import-calculator) — enter price + province + year, click Calculate, full breakdown renders (FOB, freight, duty, broker, GST, total)
    5. Find My JDM (/find-my-jdm) — form submits, Docket POST succeeds
    6. Navigation — header links work, mobile hamburger opens/closes, footer links resolve
    7. Contact (/contact) — page loads, form renders
    8. FAQ (/faq) — search filters results, accordion expands/collapses
-->

## Authed-QA session (how QA logs in for runtime tests)

<!--
  The ONE working path for QA to get an AUTHENTICATED browser session against THIS
  project's dev server, for logged-in flows. QA must not re-improvise this each run.
  Document: the auth mechanism; a test account or how to seed one; the exact working
  recipe (UI login vs cookie-mint; headless vs HEADED persistent context); any
  dev-vs-prod difference; and teardown (0 residual).
  Example:
    - Mechanism: supabase-ssr (cookie sb-<ref>-auth-token) / or authjs cookie-mint.
    - Test account: seed via scripts/seed-qa.mjs; delete after; verify 0 residual.
    - Working path: HEADED persistent Chrome + UI login at /login. A scripted HEADLESS
      session is rejected by dev SSR here (works on prod) — use headed.
    - Teardown: delete seeded records + auth user; confirm 0 residual, null-auth 0.
  If this is BLANK, QA cannot do authed runtime tests — fill it in.
-->

## Loop Hints

<!--
  Agent strengths and what parallelizes for THIS specific repo.
  Example:
    - Coder: best at implementation, pipelines, scrapers, config
    - Reviewer: static analysis, TypeScript edge cases, a11y audit
    - Designer: visual pages, layout, responsive design
    - QA: runtime flows, mobile verification, console/network errors
    - What parallelizes: review + QA on code_ready branches; design can run ahead of implementation on visual pages
    - What does NOT: implementation must wait for design-lock on visual pages; merge must wait for both review AND QA green
-->
