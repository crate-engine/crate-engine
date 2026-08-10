#!/usr/bin/env bash
# get-crate.sh — the Crate Engine one-liner (P6-2).
#   curl -fsSL <url>/installer/get-crate.sh | bash
#   ... | bash -s -- --engine-source <path|url>     (dev/beta override)
#
# Lays down: node · the brain clone at ~/.crate/engine (+ core deps, dist
# verified) · the `crate` CLI — then you run `crate open`, which starts the
# headless app server and opens the app-mode window (T8: cmux is gone — the app
# is its own window). It does NOT install or sign in AI agents (the P6-6 direction
# change): the product assumption is that your agents — Claude Code, Pi — are
# already on this machine and signed in; the app detects and offers them.
# Idempotent: re-runs heal, never clobber. macOS + Linux; BSD-safe by
# construction (no GNU-isms).
set -euo pipefail

ENGINE_SOURCE="https://github.com/crate-engine/crate-engine.git"  # PRODUCT_ENGINE_ORIGIN (the distribution repo)
NO_OPEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --engine-source) ENGINE_SOURCE="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;   # scripted/test runs skip the launch handoff
    *) echo "get-crate: unknown flag $1" >&2; exit 2 ;;
  esac
done

# ── looks: the engine-room identity (signal-amber on graphite, stencil caps).
#    Colors only when stdout is a real terminal (CRATE_COLOR=1 forces, for QA);
#    piped/captured output stays plain so logs and tests read clean. ──────────
if [ -t 1 ] || [ "${CRATE_COLOR:-}" = "1" ]; then
  AMBER=$'\033[38;5;214m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  AMBER=""; BOLD=""; DIM=""; GREEN=""; RED=""; RESET=""
fi

say()  { printf '  %s\n' "$*"; }
step() { printf '\n%s==%s %s%s%s\n' "$AMBER" "$RESET" "$BOLD" "$*" "$RESET"; }
die()  { printf '%sget-crate:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

banner() {
  printf '\n%s' "$AMBER"
  printf '  ╭─────────────────────────────────────────────╮\n'
  printf '  │                                             │\n'
  printf '  │    C R A T E %s▪%s%s E N G I N E                  │\n' "$RESET$BOLD" "$RESET" "$AMBER"
  printf '  │    %san AI dev team, in a box%s%s                 │\n' "$RESET$DIM" "$RESET" "$AMBER"
  printf '  │                                             │\n'
  printf '  ╰─────────────────────────────────────────────╯\n'
  printf '%s' "$RESET"
  printf '\n  %sWelcome aboard.%s Five teammates, zero coffee breaks — let%ss pry this crate open.\n' "$BOLD" "$RESET" "'"
  printf '  %s3 quick steps · your AI agents stay yours — nothing gets installed or signed in on their behalf%s\n' "$DIM" "$RESET"
}

# Gate-day finding #3: long steps used to go silent — no way to tell working
# from wedged. run_long shows life (a dot every ~2s), keeps the step's full
# output in a log, and prints that log when the step fails (findings need it).
#   run_long <label> <fail-message> <cmd> [args…]
run_long() {
  local rl_label="$1" rl_fail="$2"; shift 2
  # portable across BSD/GNU mktemp (GNU refuses a template with no X's)
  local rl_log; rl_log="$(mktemp "${TMPDIR:-/tmp}/crate-install.XXXXXX")"
  printf '  %s ' "$rl_label"
  "$@" >"$rl_log" 2>&1 &
  local rl_pid=$!
  while kill -0 "$rl_pid" 2>/dev/null; do printf '.'; sleep 2; done
  printf '\n'
  if ! wait "$rl_pid"; then
    printf -- '---- output of the failed step ----\n' >&2
    cat "$rl_log" >&2
    die "$rl_fail"
  fi
}

banner

# ── preflight: macOS or Linux. On mac, Homebrew is required LAZILY (only if
#    something must actually be installed; never auto-installed). On linux,
#    bubblewrap is a HARD preflight — it renders the seat sandbox walls, and a
#    wall-less install must fail loud here, not at seat boot. ─────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) : ;;
  *) die "unsupported OS: $OS (Crate Engine runs on macOS and Linux)." ;;
esac
if [ "$OS" = "Linux" ] && ! command -v bwrap >/dev/null 2>&1; then
  die "bubblewrap (bwrap) is required on Linux — it renders the seat sandbox walls.
One-time setup, then re-run:
  sudo apt install bubblewrap    (Debian/Ubuntu; use your distro's package name otherwise)"
fi
need_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  die "$1 needs to be installed, which requires Homebrew — and Homebrew is not installed.
One-time setup, then re-run:
  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
}

# ── 1. node ≥22 (the engine's `engines` floor; T8: the app is headless + its
#    own window). Linux never needs sudo: a too-old/missing node is solved by
#    the official tarball, user-space, into ~/.crate/tools/node — used by the
#    installer below AND preferred by the `crate` shim forever after. ─────────
step "[1/3] node"
NODE_MIN=22
node_ok() {
  command -v "$1" >/dev/null 2>&1 || [ -x "$1" ] || return 1
  local v; v="$("$1" --version 2>/dev/null)" || return 1
  v="${v#v}"; [ "${v%%.*}" -ge "$NODE_MIN" ] 2>/dev/null
}
BUNDLED_NODE="$HOME/.crate/tools/node/bin/node"
if node_ok node; then
  say "node: $(node --version)"
elif node_ok "$BUNDLED_NODE"; then
  say "node: $("$BUNDLED_NODE" --version) (bundled at ~/.crate/tools/node)"
  export PATH="$HOME/.crate/tools/node/bin:$PATH"
elif [ "$OS" = "Darwin" ]; then
  need_brew "node v$NODE_MIN+"
  run_long "node: installing (brew — takes a minute or two)" \
    "node failed to install (full output above)" \
    brew install node
else
  NODE_VER="v22.14.0"
  case "$(uname -m)" in
    x86_64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    *) die "unsupported CPU $(uname -m) for the bundled node — install node v$NODE_MIN+ yourself and re-run." ;;
  esac
  mkdir -p "$HOME/.crate/tools"
  run_long "node: fetching $NODE_VER linux-$NODE_ARCH into ~/.crate/tools/node (user-space, no sudo)" \
    "the node download failed (full output above)" \
    bash -c "curl -fsSL 'https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$NODE_ARCH.tar.xz' | tar -xJ -C '$HOME/.crate/tools' && rm -rf '$HOME/.crate/tools/node' && mv '$HOME/.crate/tools/node-$NODE_VER-linux-$NODE_ARCH' '$HOME/.crate/tools/node'"
  say "node: $("$BUNDLED_NODE" --version) (bundled — used only by Crate)"
  export PATH="$HOME/.crate/tools/node/bin:$PATH"
fi

# ── 2. the brain → ~/.crate/engine (+ core deps; dist VERIFIED, not rebuilt) ─
step "[2/3] the engine → ~/.crate/engine"
CRATE_DIR="$HOME/.crate"
ENGINE_DIR="$CRATE_DIR/engine"
mkdir -p "$CRATE_DIR"
# Gate-day finding #2: a LOCAL --engine-source owned by ANOTHER user (the
# staged gate package under /Users/Shared) trips git's dubious-ownership
# refusal. Trust exactly that source, in THIS user's own git config, before
# touching it. A real user cloning from GitHub owns their clone — this branch
# never fires for them.
if [ -d "$ENGINE_SOURCE" ] && [ -e "$ENGINE_SOURCE/.git" ]; then
  if ! git -C "$ENGINE_SOURCE" rev-parse --git-dir >/dev/null 2>&1; then
    SRC_ABS="$(cd "$ENGINE_SOURCE" && pwd -P)"
    say "engine source: owned by another user — trusting this one path (git safe.directory)"
    git config --global --add safe.directory "$SRC_ABS"
    git config --global --add safe.directory "$SRC_ABS/.git"
  fi
fi
if [ -d "$ENGINE_DIR/.git" ]; then
  say "engine: present ($ENGINE_DIR) — kept (update later with: crate update)"
else
  [ -e "$ENGINE_DIR" ] && die "$ENGINE_DIR exists but is not a git clone — move it aside and re-run."
  # Reachability precheck (remote sources only): fail in PLAIN WORDS before
  # the clone — never a raw git error. The public engine repo needs NO sign-in
  # (public since H4, 2026-07-27); the auth branch only matters for private
  # --engine-source forks.
  if [ ! -d "$ENGINE_SOURCE" ]; then
    LS_ERR="$(GIT_TERMINAL_PROMPT=0 git ls-remote "$ENGINE_SOURCE" HEAD 2>&1 >/dev/null)" || {
      case "$LS_ERR" in
        *"could not read Username"*|*"terminal prompts disabled"*|*"Authentication failed"*|*"Invalid username or"*|*"No credentials"*)
          die "this engine source needs a GitHub sign-in ($ENGINE_SOURCE).
The public Crate Engine repo needs no sign-in — this usually means a private --engine-source fork.
One-time setup, then re-run:  install the GitHub CLI (https://cli.github.com), then  gh auth login" ;;
        *"Repository not found"*|*"not found"*|*"403"*)
          die "the engine repo wasn't found at $ENGINE_SOURCE.
Check the URL — the public engine lives at https://github.com/crate-engine/crate-engine" ;;
        *)
          die "could not reach the engine repo ($ENGINE_SOURCE):
$LS_ERR" ;;
      esac
    }
    say "engine repo: reachable — OK"
  fi
  run_long "engine: cloning from $ENGINE_SOURCE (can take a minute)" \
    "the engine clone failed (full output above)" \
    git clone --quiet "$ENGINE_SOURCE" "$ENGINE_DIR"
fi
if [ -d "$ENGINE_DIR/core/node_modules" ]; then
  say "engine core deps: present"
else
  run_long "engine core deps: npm install (one-time, ~1–2 minutes)" \
    "the engine's npm install failed (full output above)" \
    bash -c "cd '$ENGINE_DIR/core' && npm install --no-audit --no-fund"
fi
# The product runs DIST-ONLY: verify the committed dist matches the sources
# (the dist-sync guard — a stale dist must never ship silently).
run_long "dist-sync guard: verifying committed dist == fresh build" \
  "the engine's committed dist does not match its sources — refusing a stale CLI (report this; a maintainer must rebuild dist and push)." \
  bash -c "cd '$ENGINE_DIR/core' && npm run --silent dist-check"
say "dist-sync guard: OK"

# ── 3. the crate CLI + a persistent PATH (idempotent managed line) ───────────
step "[3/3] the crate command"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cp "$ENGINE_DIR/installer/crate" "$BIN_DIR/crate"
chmod +x "$BIN_DIR/crate"
say "crate CLI: installed to $BIN_DIR/crate"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH" # added by crate-engine installer'
if [ "$OS" = "Darwin" ]; then PROFILES="$HOME/.zprofile"; else PROFILES="$HOME/.profile $HOME/.bashrc"; fi
for PROFILE in $PROFILES; do
  if ! grep -qF "added by crate-engine installer" "$PROFILE" 2>/dev/null; then
    printf '%s\n' "$PATH_LINE" >> "$PROFILE"
    say "PATH: added $BIN_DIR to $PROFILE (new terminals pick it up automatically)"
  fi
done
export PATH="$BIN_DIR:$PATH"
# T8: no cmux-pane bootstrap hook — `crate open` starts the headless app server
# and opens the app-mode window itself (no ~/.zprofile takeover needed).

# ── your AI agents: DETECTED, never installed (the P6-6 direction change) ────
#    Crate Engine assumes your agents are already on this machine and signed
#    in — same deal as `crate up` on a working rig. This report just tells the
#    truth about what the app will offer; the staffing screen shows the same.
step "Your AI agents (detected — Crate Engine never installs or signs in agents)"
FOUND_READY=0
if command -v pi >/dev/null 2>&1; then
  if grep -q '"openai-codex"' "$HOME/.pi/agent/auth.json" 2>/dev/null; then
    say "pi: installed + signed in (ChatGPT) — ${GREEN}ready${RESET}"; FOUND_READY=1
  else
    say "pi: installed, ${AMBER}NOT signed in${RESET} — its seats won't be offered until you /login (the app will say the same)"
  fi
else
  say "pi: ${AMBER}not found on this machine${RESET} — its seats won't be offered"
fi
if command -v claude >/dev/null 2>&1; then
  if { grep -q oauthAccount "$HOME/.claude.json" && grep -q hasCompletedOnboarding "$HOME/.claude.json"; } 2>/dev/null; then
    say "claude code: installed + signed in — ${GREEN}ready${RESET}"; FOUND_READY=1
  else
    say "claude code: installed, ${AMBER}first-run setup NOT finished${RESET} — run \`claude\` once to complete it"
  fi
else
  say "claude code: ${AMBER}not found on this machine${RESET} — its seats won't be offered"
fi
if command -v codex >/dev/null 2>&1; then
  if [ -s "$HOME/.codex/auth.json" ]; then
    say "codex: installed + signed in (ChatGPT) — ${GREEN}ready${RESET}"; FOUND_READY=1
  else
    say "codex: installed, ${AMBER}NOT signed in${RESET} — run \`codex\` once to sign in"
  fi
else
  say "codex: ${AMBER}not found on this machine${RESET} — its seats won't be offered"
fi
if [ "$FOUND_READY" = "0" ]; then
  say "NOTE: no ready agents detected — that's fine for now. The app opens next and its"
  say "Welcome screen shows exactly what it sees and how to connect your crew (each agent"
  say "signs in its own way, once — Crate Engine never touches your accounts)."
fi

# ── hand off to the app ──────────────────────────────────────────────────────
step "Installed. Launching the app…"
say "(the app opens in its own window — a chromeless ⚡ Crate Engine window)"
if [ "$NO_OPEN" = "1" ]; then
  say "(--no-open) start it yourself with:  crate open"
else
  exec "$BIN_DIR/crate" open
fi
