# Adapter: Antigravity CLI (`agy`)

Onboarding card for staffing a station with **Antigravity CLI** — Google's terminal
coding agent, and the sanctioned replacement for the retired Gemini CLI wire.
`agy` runs on the operator workstation, so it is wired like the **Claude** adapter;
see `../claude/adapter.md` for the full four-wire detail. This card notes only what
is specific to `agy`. **Bring your own install + sign-in — the engine never handles
credentials.**

## Why this adapter exists (read once, saves re-deriving it)

Google stopped serving **Gemini CLI** for every consumer tier on **2026-06-18** —
free *and* paid Google AI Pro/Ultra. A consumer subscription never granted a paid
*Gemini Code Assist* tier, which is what that binary checks, so a paying user is
still refused (`IneligibleTierError`, `tierId: free-tier`). There is no sign-in to
buy back. `agy` signs in with an ordinary Google account and honours a paid Google
AI subscription. See `../gemini/adapter.md` (kept, marked dead) and CE-138.

`gemini` is a dead **harness**, not a dead model family. The models arrive here.

## Install + auth
```
curl -fsSL https://antigravity.google/cli/install.sh | bash    # → ~/.local/bin/agy
agy                                                            # browser sign-in, once
```
Native Go binary; no Node required; self-updating; SHA512-verified by its installer.
The credential lands in the **OS keyring** (Keychain on macOS, libsecret on Linux),
not a dotfile. On a headless host `agy` prints a URL + code instead of opening a
browser — and the wait is a hard **60 seconds**, which `--print-timeout` does NOT
extend, so complete it from a terminal you control rather than a relayed one.

## Launch
`launch.sh` echoes:  `agy ${1:+--model $1}`

## Headless seat wire (2026-08-18 — WIRED, not yet battle-tested)
The engine's runner drives one turn at a time (turn.ts):
```
agy -p "<prompt>" --output-format stream-json
    [--conversation <id>] [--model <m>]
    [--dangerously-skip-permissions   (walled only)]
```
- **Flag surface VERIFIED against the shipping binary's `--help`** (1.1.14,
  2026-08-18), and every frame below CAPTURED from a real run — not read from
  docs, which were wrong about the tier story and silent about the wall.
- **Sessions are real, and resume BY ID** — `--conversation <id>`, proven live
  (`num_turns: 2`, correct recall). This is the exact ambiguity that kept the
  gemini wire stateless (its `--resume` took "latest"/index).
- **`--dangerously-skip-permissions` rides ONLY inside a rendered wall** — same
  defense-in-depth as claude/codex/opencode.
- **NEVER pass `agy --sandbox` under a crate wall** — both are Seatbelt and
  Seatbelt does not nest. (`agy` has its own `--sandbox`; the wall is ours.)
- **Detection:** binary `agy` on PATH, then
  `~/.gemini/antigravity-cli/cache/onboarding.json` as a NEGATIVE-only marker,
  then a deep `agy models` probe for the positive proof. The marker alone must
  never mean READY — it records that someone signed in once, not that the
  credential is live (the CE-048/CE-138 false-READY family).
- **Catalog:** offered with model = account default; labeled "not yet
  battle-tested" on every seat until a real loop runs.

### Stream frames (captured 2026-08-18)
```
init         { conversation_id (TOP level), init:{cwd, permission_mode, tools} }
step_update  { step_update:{conversation_id, state, step_index, step_type,
                            [text_delta], [usage]} }
result       { result:{conversation_id, status, response, num_turns,
                       duration_seconds, usage} }
```
`usage` = `{input_tokens, output_tokens, thinking_tokens, cache_read_tokens,
total_tokens}` and is **nested under `result`**, not top-level as in claude/codex.
`step_update` usage is incremental — only the `result` frame is authoritative, or
every turn's total inflates. `status` ∈ `SUCCESS | ERROR | CANCELED | INTERRUPTED
| INVALID | WAITING | RUNNING`.

## The wall door — load-bearing, not housekeeping
A walled `agy` seat **silently loses its session** without a write door for
`~/.gemini/antigravity-cli`: the conversation store fails to write ("operation not
permitted" on Seatbelt, "read-only file system" on bwrap) while the turn still
returns `status: SUCCESS` with full token accounting. Resume then fails with
"conversation not found" and every turn restarts from zero, with nothing anywhere
saying so. The door ships in `stateDoorsFor()` (core/src/sandbox.ts) and is
**directory-granular deliberately** — `agy` writes `<file>.<uuid>.tmp` then
renames, the pattern that defeated claude's single-file door on Linux (CE-129).

Auth itself needs no door: the keyring rides mach services / the session bus, and
works walled on both platforms (proven).

## Models
`agy models` lists what YOUR account may staff — Gemini 3.x Flash/Pro, and also
**Claude Sonnet/Opus 4.6** and **GPT-OSS**. A seat staffed `agy` +
`claude-opus-4-6-thinking` runs Opus billed against the Google subscription. Note
this makes a seat's model provenance differ from its harness, which the Team view
does not yet distinguish.

Context note: a trivial turn measured **~13.7k input tokens** — a large fixed
system prompt. Do not read an `agy` seat's context gauge with claude-shaped
assumptions.

## Wires (same as the Claude adapter unless noted)
1. **Run-location** — workstation; reaches the repo over SSH.
2. **Peer resolution** — role keys (`orchestrator` / `coder` / `reviewer` / `designer` / `tester`).
3. **Report delivery** — `python3 .agents/bin/agentctl.py deliver orchestrator "<message>" --from <station>`
   (durable maildir + runner wake); verdicts/reports via the report skill (`config/skills/report.md`).
4. **State signal** — the shared `agentctl emit --actor <station> ...`, run from the repo root.

Models are a staffing value (`<STATION>_MODEL`), never a separate adapter.
