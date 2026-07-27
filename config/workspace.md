> **Portability:** values in `{{double braces}}` resolve from this project's `.agents/rig.conf` — PROJECT, PROJECT_PATH, DEV_URL. rig.conf is authoritative for all project-specific values.

# Workspace Blueprint — {{PROJECT}}

mode: design-led          # design-led | test-led
repo: {{PROJECT_PATH}}
dev_server_url: {{DEV_URL}}
dev_server_start: npm run dev        # or rig.conf DEV_CMD override

## Seats (role → binder)

The team is HEADLESS (T8): the app (`crate open` / `crate team`) spawns one
supervised runner per seat from the staffing sheet; there are no panes and no
terminal multiplexer. Seats address each other by ROLE KEY through the delivery
queue (`agentctl.py deliver <role> …`) — see the report skill.

| Role         | Binder                 |
|--------------|------------------------|
| orchestrator | config/orchestrator.md |
| coder        | config/coder.md        |
| reviewer     | config/reviewer.md     |
| designer     | config/designer.md     |
| tester       | config/tester.md       |

Staffing (which AGENT/model fills each seat) comes from `~/.crate/defaults.yaml`
with per-project `<ROLE>_AGENT`/`<ROLE>_MODEL` overrides in `.agents/rig.conf`.

## Notes
- Seat lifecycle (boot/stop/relaunch) belongs to the app's Team menu +
  auto-revive — a seat never spawns or revives another seat.
- Dev server cold-compiles the first page hit (~9s). Warm it up with a curl
  before opening a preview.
- Browser checks: Chrome+QR previews for human review, headless Playwright for
  agent inspection.
