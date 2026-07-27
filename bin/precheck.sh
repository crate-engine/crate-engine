#!/usr/bin/env bash
# precheck.sh <ref> — automated pre-review gate.
#
# Builds <ref> in an isolated throwaway git worktree (shared node_modules, its own
# .next), runs lint + typecheck + build, prints a COMPACT verdict, and ALWAYS tears
# down (even on failure or interrupt). It NEVER touches the live working tree, the
# live .next, or the live dev server. Emits no agentctl events — read-only w.r.t.
# rig state.
#
# Usage: precheck.sh <ref>     (ref = a branch name or a commit)
# Exit:  0 iff all non-skipped checks PASS; non-zero otherwise.

set -u

QUICK=0
[ "${1:-}" = "--quick" ] && { QUICK=1; shift; }
REF="${1:-}"
if [ -z "$REF" ]; then
  echo "usage: precheck.sh [--quick] <ref>" >&2
  exit 2
fi

# Repo root, derived from this script's location: .agents/bin/precheck.sh -> root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || { echo "precheck: cannot cd to repo root" >&2; exit 2; }

git fetch -q origin || true

# Resolve <ref>: prefer origin/<ref> if it is a remote branch, else use <ref> as-is.
if git show-ref -q --verify "refs/remotes/origin/$REF"; then
  RESOLVED="origin/$REF"
else
  RESOLVED="$REF"
fi
SHA="$(git rev-parse --short "$RESOLVED" 2>/dev/null || true)"
if [ -z "$SHA" ]; then
  echo "precheck: cannot resolve ref: $REF" >&2
  exit 2
fi

# Unique scratch worktree under a FIXED sibling dir ($$ = this script's PID).
# The worktrees stay SIBLINGS of the repo (dev-server watchers rooted at the
# repo never see them — the deliberate v1 isolation), but they live under one
# fixed `.nmgate-wt/` parent instead of a `<ref>-<pid>`-suffixed sibling, so a
# sandbox wall can open the parent with a plain path door (subpath on Seatbelt,
# a bind mount on bwrap) — a regex door is un-expressible as a bind (T7-0).
SAFE_REF="$(printf '%s' "$REF" | tr '/' '-')"
NMGATE_PARENT="$(dirname "$REPO_ROOT")/.nmgate-wt"
mkdir -p "$NMGATE_PARENT"
WT="$NMGATE_PARENT/${SAFE_REF}-$$"
LOGDIR="$(mktemp -d)"
LINT_LOG="$LOGDIR/lint.log"
TC_LOG="$LOGDIR/typecheck.log"
BUILD_LOG="$LOGDIR/build.log"
TEST_LOG="$LOGDIR/test.log"

cleanup() {
  # Always tear down. Leave the live tree pristine.
  cd "$REPO_ROOT" 2>/dev/null || true
  [ -n "${SRV_PID:-}" ] && kill -TERM -"$SRV_PID" 2>/dev/null || true
  [ -e "$WT/node_modules" ] && rm -rf "$WT/node_modules"
  git -C "$REPO_ROOT" worktree remove "$WT" --force >/dev/null 2>&1 || true
  rm -rf "$WT" >/dev/null 2>&1 || true
  rm -rf "$LOGDIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

git worktree add --detach "$WT" "$RESOLVED" >/dev/null 2>&1 \
  || { echo "precheck: git worktree add failed for $RESOLVED" >&2; exit 2; }

# Provide deps as a HARDLINKED tree: same filesystem, near-instant (no data copy),
# and a REAL directory -- Turbopack rejects a node_modules symlink that escapes the
# worktree root. Fallback to a symlink if hardlinking is unavailable (cross-fs).
# Build output stays isolated (the worktree gets its own .next).
cp -al "$REPO_ROOT/node_modules" "$WT/node_modules" 2>/dev/null \
  || ln -s "$REPO_ROOT/node_modules" "$WT/node_modules"

# Symlink the repo's local env files so Next loads them NATIVELY (its dotenv parser
# handles values with spaces/quotes, e.g. FROM_ADDRESS="Name <a@b>", which a bash
# `source` chokes on). Symlinks (not copies) keep secrets out of a 2nd on-disk file;
# teardown removes the links, never the originals.
for ef in .env .env.local .env.production .env.development; do
  [ -f "$REPO_ROOT/$ef" ] && ln -sf "$REPO_ROOT/$ef" "$WT/$ef"
done

cd "$WT" || { echo "precheck: cannot cd to worktree" >&2; exit 2; }

has_script() {
  node -e "var s=(require('./package.json').scripts)||{};process.exit(s['$1']?0:1)" 2>/dev/null
}

# --- LINT ---
# Default: whole-repo lint, ADVISORY (repos carry baseline debt). Opt-in delta gate
# (rig.conf NMGATE_LINT_DELTA=1 -> exported LINT_DELTA=1): lint only the files THIS
# branch changed and FAIL only if a changed file has MORE errors than it does on
# origin/main (per-file no-net-new). Fair to legacy debt; catches genuinely new errors.
LINT_DELTA="${LINT_DELTA:-0}"
LINT_TAG="(advisory)"
ESLINT_BIN="./node_modules/.bin/eslint"
if [ "$LINT_DELTA" = "1" ] && [ -x "$ESLINT_BIN" ]; then
  LINT_TAG="(delta-gate vs origin/main)"
  git fetch -q origin main 2>/dev/null || true
  _count_err() {  # stdin = eslint --format json  ->  total errorCount (NaN if unparseable)
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);process.stdout.write(String(a.reduce((n,f)=>n+(f.errorCount||0),0)))}catch(e){process.stdout.write("NaN")}})'
  }
  mapfile -t _CF < <(git diff --name-only --diff-filter=d "origin/main...$RESOLVED" -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null)
  LINT_NEW=0
  {
    echo "delta-lint vs origin/main -- changed lint files: ${#_CF[@]}"
    for _f in "${_CF[@]}"; do
      [ -n "$_f" ] || continue
      _rn="$(git show "$RESOLVED:$_f" 2>/dev/null | "$ESLINT_BIN" --stdin --stdin-filename "$_f" --format json 2>/dev/null | _count_err)"
      _bsrc="$(git show "origin/main:$_f" 2>/dev/null)"
      if [ -n "$_bsrc" ]; then
        _bn="$(printf '%s' "$_bsrc" | "$ESLINT_BIN" --stdin --stdin-filename "$_f" --format json 2>/dev/null | _count_err)"
      else
        _bn=0
      fi
      case "$_rn$_bn" in *NaN*) echo "  ? $_f (eslint could not run -- skipped)"; continue;; esac
      if [ "$_rn" -gt "$_bn" ]; then
        LINT_NEW=$((LINT_NEW + 1))
        echo "  NEW $_f: $_bn -> $_rn errors (+$((_rn - _bn)))"
      fi
    done
    [ "$LINT_NEW" = "0" ] && echo "no net-new lint errors in changed files."
  } >"$LINT_LOG" 2>&1
  if [ "$LINT_NEW" -gt 0 ]; then LINT_STATUS="FAIL"; else LINT_STATUS="PASS"; fi
elif has_script lint; then
  if npm run lint </dev/null >"$LINT_LOG" 2>&1; then LINT_STATUS="PASS"; else LINT_STATUS="FAIL"; fi
else
  LINT_STATUS="SKIPPED"
fi

# --- TYPECHECK (stack-aware: skips when the project ships no tsc — a static
# site or non-TS repo must not fail a TypeScript check it never had; T2) ---
if [ -x ./node_modules/.bin/tsc ]; then
  if ./node_modules/.bin/tsc --noEmit </dev/null >"$TC_LOG" 2>&1; then TC_STATUS="PASS"; else TC_STATUS="FAIL"; fi
else
  TC_STATUS="SKIPPED"
fi

# --- BUILD (timed; stack-aware: no build script = nothing to build, not a fail) ---
BUILD_START="$(date +%s)"
if has_script build; then
  if npm run build </dev/null >"$BUILD_LOG" 2>&1; then BUILD_STATUS="PASS"; else BUILD_STATUS="FAIL"; fi
else
  BUILD_STATUS="SKIPPED"
fi
BUILD_SECS="$(( $(date +%s) - BUILD_START ))"

# --- TEST (the T2 rung: detect, never assume; hung suites fail LOUDLY) ---
# PINNED detection rule (PHASE-7 T2 — no other guessing):
#   (a) AGENTS.md "## Build & Test Commands" declares a test line
#       (`- Test: ...` — a backticked command wins; none/n-a means NO), ELSE
#   (b) package.json has a `test` script that is NOT npm's default
#       placeholder ("no test specified"), run as `npm test`.
# The command runs under a timeout (NMGATE_TEST_TIMEOUT, default 300s) so a
# hung suite fails the gate loudly instead of wedging the loop forever.
TEST_CMD=""
TEST_SRC=""
TEST_DECLARED=0   # an AGENTS.md `- Test:` line existed (even "none") — the law spoke
if [ -f AGENTS.md ]; then
  _TLINE="$(awk '/^## Build & Test Commands/{f=1;next} /^## /{f=0} f' AGENTS.md | grep -E '^[-*] +Test:' | head -1 || true)"
  if [ -n "$_TLINE" ]; then
    TEST_DECLARED=1
    case "$_TLINE" in
      *\`*\`*) TEST_CMD="$(printf '%s' "$_TLINE" | sed -E 's/^[^`]*`//; s/`.*$//')" ;;
      *)       TEST_CMD="$(printf '%s' "$_TLINE" | sed -E 's/^[-*] +Test:[[:space:]]*//')" ;;
    esac
    case "$(printf '%s' "$TEST_CMD" | tr '[:upper:]' '[:lower:]')" in
      none*|n/a*|no|"") TEST_CMD="" ;;   # an explicit "none" is a DECISION: no fallback below
      *) TEST_SRC="AGENTS.md" ;;
    esac
  fi
fi
if [ -z "$TEST_CMD" ] && [ "$TEST_DECLARED" = "0" ] && has_script test; then
  if node -e 'const s=(require("./package.json").scripts||{}).test||"";process.exit(/no test specified/.test(s)?1:0)' 2>/dev/null; then
    TEST_CMD="npm test"
    TEST_SRC="package.json"
  fi
fi
TEST_TAG=""
if [ "$QUICK" != "1" ] && [ -n "$TEST_CMD" ]; then
  TT="${NMGATE_TEST_TIMEOUT:-300}"
  TEST_TAG="($TEST_SRC: $TEST_CMD, timeout ${TT}s)"
  # perl alarm+exec is portable (macOS ships no GNU `timeout`); the alarm
  # survives exec, so the suite dies on SIGALRM (exit 142) at the deadline.
  if CI=1 perl -e 'alarm shift @ARGV; exec @ARGV' "$TT" sh -c "$TEST_CMD" </dev/null >"$TEST_LOG" 2>&1; then
    TEST_STATUS="PASS"
  else
    _RC=$?
    if [ "$_RC" -eq 142 ]; then
      TEST_STATUS="TIMEOUT"
      echo "TEST TIMED OUT after ${TT}s — a hung suite fails the gate loudly (raise rig.conf NMGATE_TEST_TIMEOUT if the suite is legitimately slow)." >>"$TEST_LOG"
    else
      TEST_STATUS="FAIL"
    fi
  fi
else
  TEST_STATUS="SKIPPED"
fi

# --- Compact verdict ---
echo "PRECHECK $REF @ $SHA"
echo "LINT:      $LINT_STATUS $LINT_TAG"
echo "TYPECHECK: $TC_STATUS"
echo "BUILD:     $BUILD_STATUS (${BUILD_SECS}s)"
echo "TEST:      $TEST_STATUS $TEST_TAG"

# --- RUNTIME SMOKE RUNG (PDR dev/pdr/runtime-smoke-rung.md; 2026-07-25) ---
# Boots the BUILT worktree ephemerally (prod-first via serve-resolve), drives the
# AGENTS.md Critical-Path routes GET-only, and reports SMOKE: lines. ADVISORY by
# default; rig.conf SMOKE_ENFORCE=1 makes a smoke FAIL fail the gate. Absorbs
# the old MOBILE step (mobile load fatal-only; overflow stays an advisory line;
# mobile JUDGMENT stays QA's). Full runs only (--quick skips; SMOKE_ON_QUICK=1
# opt-in for debugging the rung itself). Riders (all mechanized below):
#   1 kill the process GROUP + prove the port freed (leftover server = flake)
#   2 never smoke a listener that is not our own child group (stale-dev lesson)
#   3 hard ready-deadline, tunable — deadline passed = advisory skip, never hang
#   4 serve inherits the gate env EXACTLY (incl. PREVIEW_DB_URL redirect); GET-only
SMOKE_STATUS="SKIPPED"; SMOKE_NOTE=""
# BUILD SKIPPED (a no-build project: the tree IS the deployable artifact) still
# smokes — only a build FAIL leaves nothing coherent to serve. Static projects
# are exactly where the chore tier's "runtime eye made of code" matters most.
if { [ "$BUILD_STATUS" = "PASS" ] || [ "$BUILD_STATUS" = "SKIPPED" ]; } && { [ "$QUICK" != "1" ] || [ "${SMOKE_ON_QUICK:-0}" = "1" ]; }; then
  # a. Resolve the serve command — ONE source of truth (shared with dev-server).
  #    Shape-detect on the WORKTREE (the built artifact); conf from the LIVE
  #    repo's .agents (the worktree carries no staffing sheet).
  RES="$(bash "$SCRIPT_DIR/serve-resolve" gate "$WT" "$REPO_ROOT" 2>/dev/null)"
  SMODE="$(printf '%s\n' "$RES" | sed -n 's/^MODE=//p')"
  SCMD="$(printf '%s\n' "$RES" | sed -n 's/^CMD=//p')"
  if [ -z "$SCMD" ] || [ "$SMODE" = "none" ]; then
    SMOKE_NOTE="no serve command resolves (non-web or empty project) — set GATE_START_CMD to opt in"
    echo "SMOKE:     SKIPPED ($SMOKE_NOTE)"
  else
    # b. Verified-free port (portable node listen-probe).
    MPORT=3100
    while ! node -e "const s=require('net').createServer().once('error',()=>process.exit(1));s.listen($MPORT,()=>s.close(()=>process.exit(0)))" 2>/dev/null; do
      MPORT=$((MPORT + 1))
    done
    SHOTS="/tmp/precheck-shots-${SAFE_REF}"
    rm -rf "$SHOTS" 2>/dev/null || true
    mkdir -p "$SHOTS"
    # c. Spawn DETACHED in its own process group, in the WORKTREE, inheriting
    #    the gate's env exactly (Rider 4 — PREVIEW_DB_URL redirect included).
    SRV_PID="$(GATE_PORT=$MPORT DEV_PORT=$MPORT DEV_BIND=127.0.0.1 node -e '
      const fs = require("fs"), { spawn } = require("child_process");
      const log = fs.openSync(process.argv[1], "a");
      const c = spawn("bash", ["-lc", process.argv[2]], { detached: true, stdio: ["ignore", log, log] });
      console.log(c.pid); c.unref();' "$LOGDIR/server.log" "$SCMD")"
    # d. Ready-deadline (Rider 3): rig.conf SMOKE_READY_SECS (default 60);
    #    AGENTS.md "Ready deadline:" wins when present (read via smoke-check).
    DEADLINE="${SMOKE_READY_SECS:-60}"
    AMD_DEADLINE="$(node "$SCRIPT_DIR/smoke-check.js" --agents-md "$WT/AGENTS.md" --print-routes 2>/dev/null | sed -n 's/.*"deadline":\([0-9]*\).*/\1/p')"
    [ -n "$AMD_DEADLINE" ] && DEADLINE="$AMD_DEADLINE"
    MREADY=""
    for _ in $(seq 1 "$DEADLINE"); do
      curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$MPORT/" 2>/dev/null && { MREADY=1; break; }
      kill -0 "$SRV_PID" 2>/dev/null || break   # server died — stop waiting
      sleep 1
    done
    if [ -z "$MREADY" ]; then
      SMOKE_NOTE="server not ready in ${DEADLINE}s (raise SMOKE_READY_SECS or AGENTS.md 'Ready deadline:') — cmd: $SCMD"
      echo "SMOKE:     SKIPPED ($SMOKE_NOTE)"
    else
      # e. Rider 2 — the listener on OUR port must belong to OUR child group.
      OWNED=""
      if command -v lsof >/dev/null 2>&1; then
        for LPID in $(lsof -t -iTCP:"$MPORT" -sTCP:LISTEN 2>/dev/null); do
          LPGID="$(ps -o pgid= -p "$LPID" 2>/dev/null | tr -d ' ')"
          [ "$LPGID" = "$SRV_PID" ] && { OWNED=1; break; }
        done
      else
        OWNED="unverifiable"
      fi
      if [ -z "$OWNED" ]; then
        SMOKE_NOTE="listener on :$MPORT is NOT the rung's own server (port injection failed / another server answered) — refusing to smoke the wrong code"
        echo "SMOKE:     SKIPPED ($SMOKE_NOTE)"
      elif [ "$OWNED" = "unverifiable" ]; then
        SMOKE_NOTE="no lsof — cannot prove the listener is ours; refusing to smoke unverified"
        echo "SMOKE:     SKIPPED ($SMOKE_NOTE)"
      else
        # f. The checks (GET-only; routes from the worktree's Critical Paths).
        ENGINE_CORE_NM="$(cd -P "$SCRIPT_DIR" 2>/dev/null && cd ../core/node_modules 2>/dev/null && pwd -P)"
        SMOKE_ALLOW="$(grep -E '^[[:space:]]*SMOKE_ALLOWLIST=' "$REPO_ROOT/.agents/rig.conf" 2>/dev/null | head -1 | sed -E 's/^[^=]*=//; s/^"//; s/"$//')"
        if NODE_PATH="$REPO_ROOT/node_modules:$ENGINE_CORE_NM" node "$SCRIPT_DIR/smoke-check.js" \
             --base "http://127.0.0.1:$MPORT" --agents-md "$WT/AGENTS.md" \
             --allow "$SMOKE_ALLOW" --out "$SHOTS" >"$LOGDIR/smoke.log" 2>&1; then
          SMOKE_STATUS="PASS"
        else
          [ $? -eq 1 ] && SMOKE_STATUS="FAIL" || SMOKE_STATUS="ERROR"
        fi
        [ "$SMODE" = "dev" ] && SMOKE_NOTE="smoke=dev-mode (no prod serve resolved — dev serve can mask prod-only breaks)"
        echo "SMOKE:     $SMOKE_STATUS${SMOKE_NOTE:+ [$SMOKE_NOTE]} (mode=$SMODE, port=$MPORT)"
        sed 's/^/  /' "$LOGDIR/smoke.log"
        # g. Axe — advisory permanently in v1 (net-new-vs-baseline = future upgrade).
        if command -v axe-check >/dev/null 2>&1; then
          AXE_ROUTES="$(node "$SCRIPT_DIR/smoke-check.js" --agents-md "$WT/AGENTS.md" --print-routes 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).routes.join(","))}catch{console.log("")}})')"
          if [ -n "$AXE_ROUTES" ]; then
            echo "AXE (advisory):"
            axe-check --base "http://127.0.0.1:$MPORT" --routes "$AXE_ROUTES" 2>&1 | sed 's/^/  /' || true
          fi
        else
          echo "AXE:       SKIPPED (axe-check not on PATH — advisory only, nothing gated)"
        fi
      fi
    fi
    # h. Rider 1 — kill the GROUP, then PROVE the port freed (trap = backstop).
    [ -n "${SRV_PID:-}" ] && kill -TERM -- -"$SRV_PID" 2>/dev/null || true
    PORT_FREED=""
    for _ in $(seq 1 10); do
      node -e "const s=require('net').createServer().once('error',()=>process.exit(1));s.listen($MPORT,()=>s.close(()=>process.exit(0)))" 2>/dev/null && { PORT_FREED=1; break; }
      sleep 1
    done
    if [ -z "$PORT_FREED" ]; then
      kill -KILL -- -"$SRV_PID" 2>/dev/null || true
      sleep 1
      node -e "const s=require('net').createServer().once('error',()=>process.exit(1));s.listen($MPORT,()=>s.close(()=>process.exit(0)))" 2>/dev/null && PORT_FREED=1
    fi
    [ -z "$PORT_FREED" ] && echo "SMOKE:     WARN — port $MPORT NOT freed after group-kill (leftover server = next-run flake; investigate)"
    SRV_PID=""
  fi
fi

FAILED=""
# LINT: advisory by default; a GATE only under the opt-in delta scope
# (NMGATE_LINT_DELTA=1), where FAIL means a changed file gained errors vs
# origin/main -- never legacy baseline debt.
[ "$LINT_DELTA" = "1" ] && [ "$LINT_STATUS" = "FAIL" ] && FAILED="$FAILED LINT"
[ "$TC_STATUS" = "FAIL" ] && FAILED="$FAILED TYPECHECK"
[ "$BUILD_STATUS" = "FAIL" ] && [ "${BUILD_FATAL:-1}" != "0" ] && FAILED="$FAILED BUILD"
[ "$TEST_STATUS" = "FAIL" ] && FAILED="$FAILED TEST"
[ "$TEST_STATUS" = "TIMEOUT" ] && FAILED="$FAILED TEST(TIMEOUT)"
# SMOKE: advisory by default; a GATE only under opt-in SMOKE_ENFORCE=1 — and
# only a real FAIL gates. ERROR (rung crash) stays advisory even under enforce:
# a flaky gate is worse than no gate (doctrine), so rung-flake never false-FAILs.
[ "${SMOKE_ENFORCE:-0}" = "1" ] && [ "$SMOKE_STATUS" = "FAIL" ] && FAILED="$FAILED SMOKE"

print_tail() { echo "--- $1 tail ---"; tail -n 15 "$2"; }
[ "$LINT_STATUS" = "FAIL" ]  && print_tail LINT "$LINT_LOG"
[ "$TC_STATUS" = "FAIL" ]    && print_tail TYPECHECK "$TC_LOG"
[ "$BUILD_STATUS" = "FAIL" ] && print_tail BUILD "$BUILD_LOG"
[ "$TEST_STATUS" = "FAIL" ] || [ "$TEST_STATUS" = "TIMEOUT" ] && print_tail TEST "$TEST_LOG"

if [ -n "$FAILED" ]; then
  echo "RESULT: FAIL ($(echo "$FAILED" | xargs))"
  exit 1
fi
echo "RESULT: ALL PASS"
exit 0
