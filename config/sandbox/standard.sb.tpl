; standard.sb.tpl — Seatbelt profile for WRITING seats (Coder, Designer, QA).
; Shape: allow-default + write-wall + named doors (vision §8.3 "the allowlist"):
; writes are scoped to THE PROJECT plus runtime scratch and the harness's state.
; The user's home, other repos, and system paths are write-denied at the OS
; level. Network stays per-seat on/off at the launcher layer (coarse by design
; at MVP — see §8.3 Network honesty).
; Placeholders: the project + home tokens and a doors marker line, substituted
; by the profile generator (crate-core core/src/sandbox.ts).
(version 1)
(allow default)
(deny file-write*)
; the project itself — the seat's whole writable world
(allow file-write*
  (subpath "{{PROJECT}}"))
; runtime scratch (node/npm/vite/pi need TMPDIR) + tty/null
(allow file-write*
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (literal "/dev/null")
  (regex #"^/dev/tty"))
; the harness's own config/session/auth state
(allow file-write*
  (subpath "{{HOME}}/.pi"))
; {{DOORS}} — extra per-seat write doors expand here (policy.sandbox_doors)
; NOTE (Coder, git push): reads of ~/.gitconfig and keychain-backed credential
; lookups ride mach services under allow-default; no write door needed. npm
; cache writes ({{HOME}}/.npm) are NOT opened by default — `npm ci`/installs in
; a sandboxed seat need a deliberate extra door via the seat's loadout policy
; (sandbox_doors: ["~/.npm"] — the Phase-3 Coder carries it).
;
; --- RESERVED, UNBUILT: Browser Harness trial doors (Phase-4 go required) ---
; per-seat-tooling.md §B.3: if Adam green-lights the trial, the QA seat pins
; the harness's ENTIRE mutable surface inside its own walls via env
; (BH_HOME / BH_AGENT_WORKSPACE / BH_RUNTIME_DIR / BH_TMP_DIR) pointing at a
; project-tier dir, e.g. added through sandbox_doors:
;   (allow file-write* (subpath "{{PROJECT}}/.agents/state/bh"))
; Launch env for the trial: BH_DOMAIN_SKILLS=0 (the brain owns the skill
; layer), BH_TELEMETRY=0, BROWSER_USE_CLOUD_SYNC=false; `browser-harness
; --update` (self-update) is forbidden; api.browser-use.com + posthog blocked.
; DO NOT UNCOMMENT / BUILD without the separate Phase-4 go.
