# FLAWS.md — {{PROJECT}}

> Per-project log of weaknesses / footguns / recurring friction the rig notices
> while operating. Append briefly; never self-fix on impulse; surface at stopping points.
>
> **TAG every entry `[project]` or `[engine]`:**
> - **`[project]`** — a flaw in THIS project's code / config / process. Fix via a
>   normal loop in this rig.
> - **`[engine]`** — a flaw in the SHARED Crate Engine (state-machine, agentctl, the
>   merge gate, station binders/adapters, scripts). The rig **NEVER self-fixes the
>   engine.** `[engine]` entries are the **surfacing queue to the brain**: the
>   orchestrator brings them to the human, who carries them to the brain-hardening
>   track, where they land in the engine's own root `FLAWS.md` and are fixed there
>   (fix → push → `crate update`). Once ported, move the entry to Resolved below with
>   a "→ brain FLAWS" note so it isn't surfaced twice.

## Open
- (none yet)

## Resolved
- (none yet)
