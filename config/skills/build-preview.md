---
name: build-preview
type: skill
description: When the human operator wants to test/preview/"see" a dev build himself — "let me test this", "give me a QR code", "preview the X page", "try it on my phone", "open it so I can check it", or at a human-test / merge gate — generate ONE branded preview card (a QR for the mobile test + an "Open on this computer" button for the desktop test, same dev route) and open it for him. Default to this format; do not hand-roll a one-off page.
inputs: a route to test; the preview base from `bin/preview-base`; BRAND_* from rig.conf; optional build-note
outputs: a self-contained HTML card (QR + desktop button) REGISTERED with the cockpit, so it reaches the operator wherever they are
side_effects: writes one temp HTML file; registers a preview with the cockpit; may ALSO open a local browser; no source changes
---

# Build preview — QR (mobile) + desktop button

The human operator likes to test a build himself before it ships, on BOTH viewports
at once: one branded card with a **QR code** he scans with his phone (the mobile
test) and an **"Open on this computer"** button (the desktop test) — same route, two
viewports. Reproduce this exact format every time so the experience is consistent.

This is a brain skill (agent-agnostic): the RECIPE below is portable. The
"open it in a browser" verb belongs to your adapter's run-location layer (see
`adapters/<agent>/adapter.md` "Browser preview" — macOS `open`, Linux `xdg-open`).

## When to use
- The operator asks to preview / test / try / "see" a page himself, asks for a QR,
  or you reach a human-test / merge gate where he tests the built page interactively.
- NOT for agent-driven inspection (that is headless Playwright) — this is FOR THE HUMAN.

## Inputs (read, never guess)
- **Preview base (`<BASE>`) — ASK, never assemble it yourself (CE-146):**
  ```
  eval "$(bash .agents/bin/preview-base "$PROJECT_PATH")"   # sets BASE REACH HOST PORT
  ```
  `bin/preview-base` owns the host half of the answer the way `bin/serve-resolve`
  owns the port: `PREVIEW_URL` tunnel if configured (`REACH=tunnel`), else this
  machine's real LAN address (`REACH=lan`), else `localhost` (`REACH=local`).
  **Do NOT use `DEV_URL` as the base.** `DEV_URL` is where the dev server BINDS —
  attach seeds it as `http://localhost:<port>` and heals it back to loopback on
  purpose — and a localhost base is unreachable from the phone that is meant to
  scan the QR. That mismatch is CE-146: on every fresh rig the QR was unscannable
  by construction, and the one run that worked only did because the agent noticed
  and read the IP by hand. Never invent an IP — the resolver reads it.
  The card hint `{REACH_NOTE}` follows `REACH`:
    - `tunnel` → "Scan with your phone -- works from anywhere (secure link)"
    - `lan` → "Scan with your phone's camera (same Wi-Fi as the dev host)"
    - `local` → "This machine only -- no LAN address was resolvable, so the QR
      will not work from a phone. Set `DEV_HOST_IP` in rig.conf, or configure a
      `PREVIEW_URL` tunnel." Say the same in your report; do not present a
      local-only card as a phone test.
  If `PREVIEW_URL` is set but the warm-up below fails, re-run the resolver with
  `PREVIEW_URL=` to fall back to the LAN base, and say so.
- **Route** = the page the operator asked about (`/sell`, `/listings`, `/`). If he just
  built something and says "let me test it," use that page's route. Ask one short
  question only if genuinely ambiguous.
- **Brand tokens** from `rig.conf` (OPINION — each project brands its own card; the
  engine ships none): `BRAND_NAME`, `BRAND_ACCENT`, `BRAND_BG`, `BRAND_FG`. Defaults
  when a token is unset, so the card works brand-neutrally on ANY project:
    - `BRAND_NAME` → the project's `PROJECT` (title-cased, e.g. `acme-shop` → "Acme
      Shop"); if `PROJECT` is unavailable too, the literal "Dev Preview".
    - `BRAND_BG` `#0d1117` · `BRAND_FG` `#ffffff` · `BRAND_ACCENT` `#3b82f6` (neutral
      dark + blue — deliberately not any product's palette).
  Never hardcode a brand in the card; it comes from the project layer only.
- **Build-note** (optional) = a short context line, e.g. `main @ <sha> (Phase 8)`.

## Procedure (run on the operator workstation — where the browser is)
0. **Ensure the preview transport is up (automatic).** If the rig sets
   `PREVIEW_PROVIDER` (tailscale/custom) in `rig.conf`, bring the tunnel up before
   building the card — it is idempotent, so this both first-time-enables and
   self-heals a dropped tunnel. Run the host helper over SSH:
   `ssh <DEV_HOST> "<PROJECT_PATH>/.agents/bin/preview-tunnel up <PROJECT_PATH>"`
   (`DEV_HOST` is the rig host's SSH target; rigs attached before 2026-08-18 spell
   the same key `SUPERMAN_HOST` — honour whichever your `rig.conf` carries). On a
   local rig (`DEV_HOST="local"`) run the helper directly, no SSH.
   It (re)asserts the serve mapping and writes the resolved `PREVIEW_URL` into
   rig.conf; re-run `preview-base` after. If the helper or tailscale is unavailable,
   fall back to the resolver's LAN base (the card adapts via `{REACH_NOTE}`). On
   `PREVIEW_PROVIDER=none`, skip this step — the resolver's LAN base is what you use.
1. **Warm the route** so the cold compile does not show a blank screen (Next dev
   cold-compiles the first hit ~9–11s). `200`, `307`, `308` all mean the server
   answered (a `307` to `/login` is normal for an auth-gated route):
   ```
   curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 "<BASE><route>"
   ```
2. **Render the QR locally** (offline; no third party sees the URL) and embed it as a
   self-contained data URI:
   ```
   QR=$(python3 -c "import segno,io,base64; b=io.BytesIO(); segno.make('<BASE><route>').save(b, kind='png', scale=10, border=2); print('data:image/png;base64,'+base64.b64encode(b.getvalue()).decode())")
   ```
   One-time install if missing: `pip3 install --user segno` (the cockpit's attach
   screen offers this as one click; `crate doctor` flags it).

   **DEGRADE, DON'T FAIL (CE-109).** If segno is unavailable, still SHIP THE CARD —
   without the QR block, with this line in its place:

   ```html
   <div class="legend"><b>No QR on this card</b> — the local QR renderer (segno) is not
   installed on the rig host. Open the URL above on your phone by hand for the mobile
   test, or install it once with <code>pip3 install --user segno</code> and regenerate.</div>
   ```

   Then say the same thing in your report. A missing QR costs the operator one
   copy-paste; refusing to produce the preview at all costs them the whole review —
   the same degrade-don't-fail rule axe-check follows ("AXE NOT VERIFIED — …", exit 0).
   The desktop half of the card is unaffected either way.

   **Never render the QR via an external web service**, with or without segno: the
   preview URL is a PRIVATE tunnel address, and shipping it to a third party
   contradicts safe-by-default (P4-10). There is no external fallback, by design.
3. **Write the card** to a temp HTML file, substituting the brand tokens, `<BASE><route>`,
   `$QR`, the title, and the build-note:
   ```html
   <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <title>{BRAND_NAME} — {TITLE} preview (dev)</title>
   <style>
     :root{color-scheme:dark}
     body{margin:0;background:{BRAND_BG};color:{BRAND_FG};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:32px;box-sizing:border-box}
     h1{font-size:28px;font-weight:800;margin:0 0 6px}
     .accent{color:{BRAND_ACCENT}}
     p{color:#a8b0bd;margin:4px 0;font-size:16px}
     .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;text-align:center;max-width:520px;width:100%}
     .qr{background:#fff;padding:16px;border-radius:12px;display:inline-block;margin:18px 0}
     .url{font-family:ui-monospace,Menlo,monospace;font-size:18px;color:{BRAND_ACCENT};word-break:break-all}
     a.btn{display:inline-block;margin-top:10px;background:{BRAND_ACCENT};color:{BRAND_FG};text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:16px}
     .legend{margin-top:14px;font-size:14px;color:#a8b0bd;line-height:1.6}.legend b{color:{BRAND_FG}}
     .note{margin-top:18px;font-size:14px;color:#7a828f;max-width:460px}
   </style></head><body>
   <div class="card">
     <h1>{BRAND_NAME} <span class="accent">{TITLE}</span> — Dev Test</h1>
     <p>{REACH_NOTE}</p>
     <div class="qr"><img src="{QR}" alt="QR to <BASE><route>" width="320" height="320"></div>
     <div class="url"><BASE><route></div>
     <a class="btn" href="<BASE><route>">Open on this computer</a>
     <div class="legend"><b>QR</b> &rarr; your phone = the <b>mobile test</b>.<br><b>Open on this computer</b> &rarr; the <b>desktop test</b>.</div>
     <div class="note">{BUILD_NOTE}. Live dev server, not production. Note anything broken and the team will be dispatched.</div>
   </div></body></html>
   ```
   `{TITLE}` defaults to the route path title-cased (`/sell` → "Sell", `/` → "Home").
4. **REGISTER the card. ALWAYS. No condition, no alternative (CE-005).**

   ```
   python3 .agents/bin/agentctl.py preview <BASE><route> --route <route> \
       --label "<TITLE> — dev test" --from <your seat>
   ```

   A registered preview rides the cockpit proxy and reaches the operator's own
   machine, wherever that is. **There is no branch here and no "instead".** If you
   have produced a preview and have not run this command, you have not delivered a
   preview — a raw URL in a report, a screenshot written to `/tmp`, and a browser
   window on this host are none of them the deliverable.

   Until 2026-08-18 this step read as an either/or, and carved out an exception for
   a seat running unwalled on the operator's own machine with a display. On the
   operator's own Mac that exception applies, so a correctly-staffed seat read this
   skill, correctly judged itself to qualify, opened Chrome — and never registered.
   `preview.json` empty, the cockpit's Preview surface blank, twice in a row on two
   different loops. **The seat followed the SOP exactly; the SOP permitted the gap.**
   So the exception is gone, and this note deliberately does not restate it in a form
   you could act on: register first, every time, whatever machine you are on.

   **OPTIONAL EXTRA, after registering:** if you are unwalled on the operator's own
   machine with a display, you may ALSO open the card locally
   (`open -a "Google Chrome" <file>` / `xdg-open <file>`). Never in place of
   registering, and never as a reason to skip it. From inside a wall this fails
   anyway and used to look like a hang: `xdg-open` FATALs on the wall's read-only
   `~/.config`, and on a headless host there is no display at all.

   Then point the operator at the registered card in your report.
5. **Tell the operator how to use it**, briefly: open the card from the cockpit's
   Preview surface, then scan the QR with his phone or click "Open on this computer"
   for desktop. On `REACH=lan` add the same-Wi-Fi caveat (the phone must be on the
   dev host's network); on `REACH=tunnel` say it works from anywhere; on
   `REACH=local` say plainly that the phone half will NOT work and why. If the route is auth-gated he hits
   login first and signs in on his own device. Invite him to report anything broken.

## Why these choices
- **Local QR** (segno) keeps the card self-contained and never sends the dev URL to a
  third party. There is deliberately NO external fallback. Until 2026-08-17 this line
  described a third-party QR API as an acceptable backstop, which directly contradicted
  step 2 and invited a seat to resolve the conflict by sending a private tunnel URL to
  someone else's server. Absent segno, the card ships without a QR (step 2) — never
  with one fetched from a stranger.
- **Phone must share the dev host's WiFi** — the dev server is a LAN address, not a
  public URL. Always say this; it is the #1 reason a scan "does not load." A configured
  `PREVIEW_URL` (e.g. a tunnel) REMOVES this constraint -- then say "works from anywhere".
- **The base comes from `bin/preview-base`, not from `DEV_URL`** — `DEV_URL` answers
  "where does the server bind", which attach actively heals back to loopback; the card
  answers "what does a human's device open". Reading one for the other is CE-146, and
  it produced an unscannable QR on every fresh rig.
- **Registration is unconditional** (CE-005) — a browser window on the engine host is
  worthless the moment the operator is looking through the fleet rail from another
  machine, it leaves no durable artifact to come back to, and the design-lock hold
  gates on a confirm whose only evidence would be that ephemeral window. The
  registered card is the one surface that is true in every topology, so it is not a
  branch of the procedure — it IS the procedure.
- **One card, two entry points** = the operator checks mobile (real device) and desktop
  without you generating two artifacts.
- **Brand tokens from rig.conf** = each project's card is branded as ITS product; the
  engine ships neutral defaults (stranger test).
