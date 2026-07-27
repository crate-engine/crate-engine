#!/usr/bin/env bash
# rig-wait.sh — the shipped backstop watcher (run #14: orchestrators had to
# improvise this inline twice; now it's in the box, reached via .agents/bin).
#
# Two modes, both run FROM THE PROJECT ROOT, normally in the background:
#
#   bash .agents/bin/rig-wait.sh <baseline-state> [interval]
#       Polls the state machine; exits 0 printing "CHANGED: <state>" the
#       moment the state LEAVES <baseline>. The dispatch backstop: launch it
#       right after dispatching the Coder (baseline=implementing) and the
#       code_ready emit surfaces even if the pushed report stalls.
#
#   bash .agents/bin/rig-wait.sh --files <name>[,<name>...] [interval]
#       Captures each named state file's mtime NOW (.agents/state/<name>,
#       ".md" appended if missing), then exits 0 printing "ALL-REPORTED: ..."
#       once EVERY file has changed. The verdict join: reviewer,tester write
#       their state files right before reporting — launch after the parallel
#       Review+QA dispatch.
#
# 2.0 rewrite of the v1 watcher WITHOUT its conf coupling (v1 sourced a
# machine rig.conf that could clobber the caller's repo and poll the wrong
# rig). Here the caller's cwd IS the rig: no conf, no SSH, no env.
set -euo pipefail

usage() {
  echo "usage: rig-wait.sh <baseline-state> [interval-secs]" >&2
  echo "       rig-wait.sh --task <branch> <baseline-state> [interval-secs]" >&2
  echo "       rig-wait.sh --files <name>[,<name>...] [interval-secs]" >&2
  exit 2
}

[ -d .agents ] || { echo "rig-wait: run from the project root (no .agents/ here)." >&2; exit 2; }
[ $# -ge 1 ] || usage

mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }

if [ "$1" = "--files" ]; then
  [ $# -ge 2 ] || usage
  INTERVAL="${3:-5}"
  FILES=()
  BASE=()
  IFS=',' read -ra NAMES <<< "$2"
  for n in "${NAMES[@]}"; do
    f=".agents/state/$n"
    case "$f" in *.md|*.yaml|*.log) ;; *) f="$f.md" ;; esac
    FILES+=("$f")
    BASE+=("$(mtime "$f")")
  done
  while :; do
    all_changed=1
    for i in "${!FILES[@]}"; do
      [ "$(mtime "${FILES[$i]}")" != "${BASE[$i]}" ] || { all_changed=0; break; }
    done
    if [ "$all_changed" = 1 ]; then
      echo "ALL-REPORTED: $2"
      exit 0
    fi
    sleep "$INTERVAL"
  done
fi

# P7-T6: --task <branch> watches ONE task's derived state in concurrent mode
# (without it, `state` prints the whole task table — fine as a string compare,
# but per-task dispatch backstops should watch their own task only).
TASK=()
if [ "$1" = "--task" ]; then
  [ $# -ge 3 ] || usage
  TASK=(--task "$2")
  shift 2
fi

BASELINE="$1"
INTERVAL="${2:-5}"
while :; do
  S="$(python3 .agents/bin/agentctl.py state ${TASK[@]+"${TASK[@]}"} 2>/dev/null || echo "$BASELINE")"
  if [ "$S" != "$BASELINE" ]; then
    echo "CHANGED: $S"
    exit 0
  fi
  sleep "$INTERVAL"
done
