# Crate Engine

**A complete engineering team, shipped as one.** Five AI agents — an
orchestrator you talk to, a coder, a reviewer, a designer, and QA — assembled,
sandboxed, and tuned to run together before the crate is ever nailed shut.

You describe what you want in plain English. The team plans it, builds it on a
branch, reviews and QA-verifies it in parallel, and then **holds at a merge
gate for your explicit go**. Nothing lands on your main without you typing the
release phrase yourself.

> **Beta, honestly labeled.** This is an early MVP. It ships with real
> guardrails (sandboxed seats, deterministic gates, an audit trail for every
> handoff), but expect rough edges — what breaks for you is exactly what we
> want to know. File it in the Issues tab.

## What you bring (read this first)

Crate Engine **never installs or signs in AI agents on your behalf, and it has
no API keys of its own** — the seats run on *your* accounts:

- **A Mac** (macOS is the only supported platform in this MVP).
- **Your own AI coding agents, installed and signed in** — Claude Code (a
  Claude subscription) and/or Pi (a ChatGPT subscription, or any provider API
  key you configure in Pi — those are metered per your provider's pricing).
  The staffing screen detects what's ready on your machine and offers exactly
  that; models Pi can run appear automatically.
- [Homebrew](https://brew.sh), only if Node isn't already installed.

## Install

```
curl -fsSL https://crate-engine.ai/get | bash
```

One command: it installs Node if needed, clones the engine to `~/.crate`,
wires the `crate` command, and opens the app. No terminal skills needed after
this line.

## Daily driving

- **First time:** the app walks you through staffing your team and attaching a
  project, then you Boot and direct your team from the Orchestrator pane — in
  plain English. Every pane streams its agent's real work live. Nothing merges
  without your explicit `merge go`.
- **Coming back:** `cd <your-project> && crate open`
- **Updates:** `crate update`, then relaunch the app.

The full operator's manual is in `docs/manual/` (PDF included).

## License

[Apache-2.0](LICENSE). Bring it into your team, fork it, build on it — the
license is permissive and the audit trail is yours.
