; readonly.sb.tpl — Seatbelt profile for READ-ONLY seats (Reviewer).
; Shape: allow-default + write-wall. v1/MVP promise = FILESYSTEM containment
; (vision §8.3 "Network honesty"): the seat can read, execute, and reach the
; network, but can write NOTHING except runtime scratch and the harness's own
; state. Even the project is write-denied — read-only enforced at the OS level,
; below the agent's tool layer.
; Placeholders: the home + project tokens and a doors marker line, substituted
; by the profile generator (crate-core core/src/sandbox.ts).
(version 1)
(allow default)
(deny file-write*)
; runtime scratch (node/pi need TMPDIR) + tty/null
(allow file-write*
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (literal "/dev/null")
  (regex #"^/dev/tty"))
; the harness's own config/session/auth state
(allow file-write*
  (subpath "{{HOME}}/.pi"))
; the seat's OWN state + session files (P1-8 × P0-6, Phase-3 inheritance #1):
; read-only is a law about the CODE, not the seat's state file — the coaching
; line ("write your state file before reporting") and the OS wall must not
; fight. The door is exactly .agents/state, nothing wider.
(allow file-write*
  (subpath "{{PROJECT}}/.agents/state"))
; {{DOORS}} — extra per-seat write doors expand here (policy.sandbox_doors)
