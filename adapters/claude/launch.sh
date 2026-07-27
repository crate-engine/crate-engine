#!/usr/bin/env bash
# Claude Code launch — prints the BARE harness command for the station's pane.
# Contract: launch.sh <model> <project>  ->  echoes one shell command line.
#
# NOT the whole launch: the engine's launcher WRAPS this line in the seat's
# sandbox wall + permission posture before it reaches a pane. Hand-typing this
# output relaunches the seat UNWALLED (run #12 finding) — to revive a seat,
# use `crate relaunch <seat> --workspace <ref>` or the app's Relaunch button.
echo "claude --model ${1:-opus}"
