#!/usr/bin/env bash
# migrate.sh <repo> [--dry-run] [--force] — move a project from the OLD engine to
# THIS engine home (the one this script lives in). Backs up .agents first, repoints
# the symlinks, links adapters, migrates rig.conf to the new format (preserving the
# existing coder agent), and renames the role-keyed state files (hermes -> coder).
#
# Run on the rig host (where the repo + engine live). Safe by default:
#   --dry-run : show every change, touch nothing.
#   --force   : proceed even if the rig isn't idle (default: refuse unless idle).
set -euo pipefail
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"      # engine home = parent of scripts/
ROOT="${PROJECTS_ROOT:-/mnt/data/projects}"

DRY=0; FORCE=0; REPO=""
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    --force)      FORCE=1 ;;
    *)            REPO="$a" ;;
  esac
done
[ -z "$REPO" ] && { echo "usage: migrate.sh <repo> [--dry-run] [--force]"; exit 1; }

PROJ="$ROOT/$REPO"
D="$PROJ/.agents"
RC="$D/rig.conf"
[ -d "$D" ] || { echo "migrate: $D not found (is the engine installed in $REPO?)"; exit 1; }

act() {  # $1 = human description ; $2 = shell command string (run unless --dry-run)
  if [ "$DRY" = 1 ]; then echo "  WOULD: $1"; else echo "  DO:    $1"; eval "$2"; fi
}

echo "=== crate migrate: $REPO ==="
echo "  engine home (target): $ENGINE"
[ "$DRY" = 1 ] && echo "  *** DRY RUN — nothing will be changed ***"
echo

# 0. Safety — only migrate an idle rig (unless --force).
STATE="$(cd "$PROJ" && python3 .agents/bin/agentctl.py state 2>/dev/null || echo '?')"
echo "  current rig state: $STATE"
if [ "$STATE" != "idle" ] && [ "$STATE" != "down" ] && [ "$FORCE" != 1 ] && [ "$DRY" != 1 ]; then
  echo "  REFUSING: rig is not idle (state=$STATE). Checkpoint + let it go idle, or pass --force."
  exit 1
fi
echo

# 1. Backup .agents (preserves symlinks AS symlinks, so rollback restores old engine).
TS="$(date +%Y%m%d-%H%M%S)"
BAK="$D.bak-$TS"
echo "[1/5] backup"
act "cp -a '$D' '$BAK'" "cp -a '$D' '$BAK'"
echo "       rollback later with:  rm -rf '$D' && mv '$BAK' '$D'"
echo

# 2. Repoint symlinks at the new engine + add adapters.
echo "[2/5] repoint symlinks -> $ENGINE"
for part in config bin adapters; do
  act "ln -sfn $ENGINE/$part  ->  $D/$part" "ln -sfn '$ENGINE/$part' '$D/$part'"
done
echo

# 3. Rename role-keyed state files: hermes -> coder.
echo "[3/5] rename state files (hermes -> coder)"
if [ -f "$D/state/hermes.md" ]; then act "mv state/hermes.md state/coder.md" "mv '$D/state/hermes.md' '$D/state/coder.md'"; else echo "  (no state/hermes.md)"; fi
if [ -f "$D/state/inbox/hermes.md" ]; then act "mv state/inbox/hermes.md state/inbox/coder.md" "mv '$D/state/inbox/hermes.md' '$D/state/inbox/coder.md'"; else echo "  (no state/inbox/hermes.md)"; fi
if [ -f "$D/state/session.md" ] && grep -q '^hermes=' "$D/state/session.md" 2>/dev/null; then
  act "session.md surfaces: hermes= -> coder=" "sed -i 's/^hermes=/coder=/' '$D/state/session.md'"
else echo "  (session.md has no hermes= line; orchestrator rewrites it on boot anyway)"; fi
echo

# 4. rig.conf: HERMES_TITLE -> CODER_TITLE, and add the staffing block (preserve coder agent).
echo "[4/5] migrate rig.conf"
if grep -q '^HERMES_TITLE=' "$RC" 2>/dev/null; then
  act "rig.conf: HERMES_TITLE -> CODER_TITLE=\"Coder\"" "sed -i 's/^HERMES_TITLE=.*/CODER_TITLE=\"Coder\"/' '$RC'"
else echo "  (no HERMES_TITLE — already migrated?)"; fi
if grep -q '_AGENT' "$RC" 2>/dev/null; then
  echo "  (staffing block already present — leaving as-is)"
else
  if [ "$DRY" = 1 ]; then
    echo "  WOULD: append staffing block (ORCH/REVIEWER/DESIGNER/TESTER=claude, CODER=hermes — preserved)"
  else
    echo "  DO:    append staffing block (CODER_AGENT=hermes preserved)"
    cat >> "$RC" <<'STAFF'

# --- Staffing (added by migrate; which agent + model per station) -----------
ORCH_AGENT="claude";     ORCH_MODEL="opus"
CODER_AGENT="hermes";    CODER_MODEL=""        # preserved from the old rig (Hermes/deepseek)
REVIEWER_AGENT="claude"; REVIEWER_MODEL="opus"
DESIGNER_AGENT="claude"; DESIGNER_MODEL="sonnet"
TESTER_AGENT="claude";   TESTER_MODEL="opus"
STAFF
  fi
fi
echo

# 5. Summary.
echo "[5/5] done"
if [ "$DRY" = 1 ]; then
  echo "  DRY RUN complete — nothing changed. Re-run without --dry-run to apply."
else
  echo "  Migrated $REPO to engine home $ENGINE."
  echo "  Backup:   $BAK"
  echo "  Rollback: rm -rf '$D' && mv '$BAK' '$D'"
  echo "  Launch (from your Mac):  crate up <SUPERMAN_HOST>:$PROJ   (host value is in $RC)"
fi