# Design-lock preview — desktop + phone QR (via the build-preview skill)

**Extracted from:** `config/orchestrator.md` — LOOP A brain hardening

When the Designer emits design_locked on a front-end/page loop, BEFORE briefing the coder
and BEFORE the design-lock hold for the human's confirm, present the design to the human on
desktop AND mobile at once. (The emit comes FIRST — it is the designer saying "ready to
show", not "the human approved"; `config/designer.md` states the same ordering, and
`reopen_design: design_locked -> designing` exists for exactly this window. CE-145.) Route = the page= from the design_locked event
(page=<slug> -> /<slug>; page=home or homepage -> /). The preview uses the LIVE
dev server, which during design serves the design branch's working tree.

Use the **build-preview** skill (`config/skills/build-preview.md`): route = the page= above,
build-note = the design branch. It generates ONE branded card (a QR for the mobile test +
an "Open on this computer" button for the desktop test, both at `<BASE><route>`), renders
the QR locally, and REGISTERS it with the cockpit so it reaches the human's own machine
(registration is unconditional — CE-005). `<BASE>` comes from `bin/preview-base`, never
from `DEV_URL`: that key is the dev server's BIND address and is unreachable from a phone
(CE-146). The card's branding comes from this project's rig.conf BRAND_* tokens — no
project specifics live here.

Then report to the human: the card is registered in the cockpit's Preview surface — open
the route there for the desktop review; scan the QR to view <route> on your phone (on the
LAN base: same Wi-Fi as the dev server; a configured PREVIEW_URL works from anywhere; if
the resolver reported REACH=local, say plainly that the phone half will not work). HOLD at the design-lock
confirm: the human reviews desktop + mobile, and only on the human's confirm do you brief the
coder to implement.

OPERATOR-OWNED DoD ITEMS RIDE THIS HOLD (orchestrator.md law, ticket-#4): batch every DoD
item only the human can settle (copy approval, pricing/legal wording, brand sign-off) into
the SAME design-lock message and get answers here — a sign-off first surfacing as a review
blocker is a rework round this hold already owed you.

NON-BLOCKING: this is a review aid. If the preview step fails (segno missing — one-time fix
`pip3 install --user segno` — or no browser), still report the preview URL as text and proceed
to the normal design-lock hold. The preview never blocks the loop. If every route 500s, the
dev server's .next is likely corrupt (see the dev-server runbook) — surface that, don't treat
it as a design problem.
