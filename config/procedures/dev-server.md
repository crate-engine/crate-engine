# Dev server — supervised, isolated, memory-bounded

The dev server runs as a **systemd `--user` service per repo**, managed by
`bin/dev-server` (symlinked into each rig as `.agents/bin/dev-server`). One service per
repo means: auto-restart on crash (survives suspend via linger), a `MemoryMax` cap so one
leaky server can't starve the others, and restart **by name** — so a station working on
one repo can NEVER take down another team's dev server.

## The rule that matters
**NEVER `pkill -f "next dev"`** (or any broad next-dev kill) — multiple rigs run dev
servers on the same host (next :3000, marketplace :3001, docket :3005, …) and a broad
kill takes down ALL of them. Always act by repo via `dev-server`.

## Commands (run on the host)
For a rig, from its repo: `.agents/bin/dev-server <cmd>`. For a NON-rig target repo
(e.g. docket), pass the path: `.agents/bin/dev-server <cmd> /path/to/<repo>`.
- `up` — (re)launch supervised on the configured port/bind (stops any ad-hoc one first).
- `restart` — clean restart (use this for a stale/corrupt `.next` or a 500-ing route,
  instead of a manual kill + `rm .next` + relaunch).
- `status` · `logs` · `down`.

## Config
The **dev PORT** has ONE resolution, owned by `bin/serve-resolve` and shared with
`preview-tunnel`, the gate and the cockpit (CE-106 — it used to be worked out
independently in four places, two of which let `dev.conf` silently override the
rig's own sheet):

    env DEV_PORT  →  rig.conf (DEV_PORT, else the last :port in DEV_URL)
                  →  dev.conf (same two routes)  →  3000

The FILE is the outer key: rig.conf is asked by *either* route before dev.conf is
consulted at all, so a stale `dev.conf` DEV_PORT cannot beat a live `rig.conf`
DEV_URL. A rig reads its `rig.conf`; a non-rig repo gets a small `.agents/dev.conf`.

- Other knobs (rig.conf → dev.conf → env → defaults): `DEV_BIND` (`0.0.0.0` — serves
  localhost AND LAN, survives an IP change), `DEV_CMD` (serve command override),
  `DEV_HEAP_MB` (node `--max-old-space-size`), `DEV_MEMMAX` (systemd cap).
- **Backend**: systemd --user (Linux) → launchd (macOS) → `bare` (nohup + pidfile) when
  the host supervises nothing, e.g. inside a seat sandbox. Bare has NO auto-restart and
  says so in its `up` line. Force it with `DEV_BACKEND=bare`.
- Heap/MemMax are a **shared budget** across all dev servers on the box — size them to
  total RAM ÷ N, not a blind large value per server (that re-creates cross-team OOM).

## Still true
- **No production build against the live dev repo** — `next build` and `next dev` share
  the working-tree `.next`; a build while dev is live corrupts dev chunks → 500s. Verify a
  branch compiles via the gate / a route-200 check, not a live build.
- A leaky dev server (e.g. a Turbopack memory watchdog restarting under load) is contained
  here (capped + auto-restarted) but the LEAK itself is a project fix — surface it.
