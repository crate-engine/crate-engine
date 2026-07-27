# Adapter: Claude Code

Onboarding card for any station staffed by a **Claude Code** agent (in this rig:
Orchestrator, Reviewer, Designer, QA). It answers the four shared wires — plus
the onboarding basics (browser tooling, plugins) — so the binder role files don't
have to. See `../README.md` for the layer model.

## 1. Run-location

- **2.x default: LOCAL.** The seat runs where its runner runs, and the project
  is the local folder the rig is attached to (`PROJECT_PATH` from `rig.conf`).
  Read, write, `agentctl`, and git are plain local operations.
- **Remote rigs (v1-style, `SUPERMAN_HOST` set in `rig.conf`) are the
  exception:** there the repo lives on the rig host — reach it over SSH, and
  **write repo/state files on the HOST over SSH** (a heredoc or the host's
  editor), never a local Write that lands where the rig can't see. If
  `SUPERMAN_HOST` is unset or `local`, none of this applies.
- **Cross-repo work: rig STATE stays at THIS rig's absolute `PROJECT_PATH`.** A task
  may TARGET a different repo — do that work there, but the rig's `.agents/state/`
  (`session.md`, `state/<station>.md`, `events.log`) and every `agentctl` emit ALWAYS
  live at this rig's `PROJECT_PATH` from `rig.conf`. Use the ABSOLUTE path (e.g.
  `/mnt/data/projects/<rig>/.agents/state`): a RELATIVE `.agents/state` resolves
  against whatever repo you `cd`'d into and silently writes state to the wrong repo.
  Never create `.agents/state` inside the target repo.
- Launch: `claude --model <model>` — model from the staffing sheet (e.g. Opus
  for Orchestrator / Reviewer / QA, Sonnet for Designer). Seat lifecycle
  (boot / stop / relaunch) belongs to the app — the Team menu or the `crate`
  CLI — never to a peer seat.

## 2. Peer resolution (role keys)

Peers are addressed by ROLE KEY — `orchestrator`, `coder`, `reviewer`,
`designer`, `tester` — nothing else. `agentctl deliver` resolves the seat and
wakes its runner; there is no map to consult and no liveness check before
sending. (Pane titles, surface ids, and the `## surfaces` block were the 1.x
cmux wiring; retired in 2.1.)

## 3. Report delivery (a result must REACH the orchestrator)

A report printed in the agent's own transcript reaches no one. Deliver to a
peer seat (almost always the orchestrator):

```
python3 .agents/bin/agentctl.py deliver <role> "<message>" --from <station>
```

- The delivery writes a **durable maildir message** AND wakes the target seat's
  runner unconditionally. No submit keys, no read-back verification: `agentctl`'s
  own `INBOX`/`QUEUED` output IS the delivery confirmation.
- Verdicts and reports go through the report skill (`config/skills/report.md`)
  — that skill is the wire.
- This applies to onboarding / proof-of-read acks too: a printed ack is invisible;
  it must be delivered the same way.

## 4. State signal

The transition *vocabulary* is binder (see `config/handoff-protocol.md` +
`config/state-machine.yaml`). A Claude agent invokes the emit over its SSH
session, from the repo root on the host:

```
python3 .agents/bin/agentctl.py emit <verb> --actor <station> key=value ...
```

`agentctl` validates the move against the state machine, logs it to
`state/events.log` (the ground truth timeline), and advances the session state.
State files in `.agents/state/` are the durable memory. When a report accompanies
the signal, pair the emit with a wire-3 `deliver` / report-skill report.

## 5. Browser preview, inspection & runtime testing

For stations that look at the running app (Designer, QA), on the workstation:

- **Preview / open a route** in a real browser at the project's dev URL
  (`DEV_URL` from `rig.conf`): macOS `open -a "Google Chrome" "<DEV_URL>/<route>"`,
  Linux `xdg-open "<DEV_URL>/<route>"`. Screenshot it and VIEW the screenshot
  yourself before showing the human. For a human build-test (a QR + desktop card the
  operator drives himself), use the `build-preview` brain skill
  (`config/skills/build-preview.md`) — it produces the card and opens it via this
  same open-verb.
- **Agent-driven page inspection / runtime testing — the IN-BOX ladder.** Your seat
  runs inside a sandbox wall: writes outside the project (+ scratch + doors) are
  OS-denied. Two consequences you must NOT fight (run #12 — they are the wall
  working, not a broken machine): **system Google Chrome cannot start inside the
  wall** (its profile/crash reporting write under `~/Library` → it FATALs on
  launch, `path_service` errors), and **`npx`/npm installs are wall-blocked**.
  Everything you need ships in-box, already on your seat PATH, proven INSIDE the
  wall. Use, in order:
  1. **`qa-sweep --project . --base <DEV_URL> --routes <list> --out <dir>`** — the
     deterministic evidence bundle: per route × viewport screenshots, console
     errors on load, responses ≥400, horizontal overflow (see the qa-method skill,
     `config/skills/qa-method.md`).
  2. **Interactive driving → `agent-browser`, via `qa-chrome`.** agent-browser's
     auto-launch drives the system Chrome (dies inside the wall) — connect it to
     the wall-safe cached chromium instead:
     `qa-chrome start` → `agent-browser connect 9223` → navigate / console /
     errors / screenshot → `agent-browser close` → `qa-chrome stop`.
  3. **Mobile-overflow shots → `node .agents/bin/mobile-check.js --base <DEV_URL>
     --routes <list> --out <dir>`** (set
     `NODE_PATH="$HOME/.crate/engine/core/node_modules"` if `playwright` isn't in
     the project) — iPhone viewport, auto-scroll, overflow measured, full-page
     screenshots.
  4. **Browser MCP** (Playwright / Claude-in-Chrome) — only if this workstation
     has one configured; a fresh install has none.
  If a rung fails, that's a finding to report (tag `[engine]`), not a reason to
  improvise with system Chrome or `npx` — those are known dead ends inside walls.
  **Logged-in flows:** headed/persistent-context sessions can't run inside a wall
  (headed Chrome won't start there); use the project's codified recipe
  (`AGENTS.md` → "Authed-QA session") to mint a session token/cookie and pass it
  via `agent-browser open <url> --headers ...`, or escalate to the orchestrator
  for an operator-driven check.
  Mobile viewports primary, then desktop.
- **Workstation footguns:** macOS has no `timeout` — use `gtimeout` (coreutils) or a
  Node/Playwright timeout. Use ABSOLUTE paths in scripts; the shell cwd resets between
  calls, so never rely on a prior `cd`.

## 6. Plugins (recommended, never required)

The engine does NOT bundle or require any plugin. Plugins live on the
**workstation**, never inside the repo. The engine only *recommends* them, and
the onboarding / installer story offers to set them up. Which plugins suit a
station is a staffing choice.

> Plugins are the **agent-native** kind of skill power (Claude-only, per-agent) —
> use them ONLY for capabilities that can't be a portable brain skill. Prefer brain
> skills (`config/skills/`) for everything else. See `config/skills/README.md`
> → "Two kinds of skill power."

- **Recommended for the Designer station: `frontend-design`** (Anthropic
  `claude-code` marketplace) for polished visual work. Optional — the Designer
  works without it, and bounded tweaks (color / spacing / copy) never need it.
  If you want it, install it on your workstation:
  ```
  /plugin marketplace add anthropics/claude-code
  /plugin install frontend-design@claude-code-plugins
  /reload-plugins
  ```
  Enable it for the workstation's Claude agents (e.g. the rig-home
  `.claude/settings.json`) so it loads when the seat starts.

## Orchestrator station

If this agent staffs the **Orchestrator**, its coordination machinery — workspace
init, recover/checkpoint, the backstop watcher, and the dev-server gotchas — is
in `orchestrator-ops.md` beside this card. The binder (`config/orchestrator.md`) holds the doctrine; that card holds the
keystrokes.
