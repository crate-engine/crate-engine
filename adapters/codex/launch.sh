#!/usr/bin/env bash
# Codex CLI launch — prints the command to type into the station's pane.
# Contract: launch.sh <model> <project>  ->  echoes one shell command line.
#
# This line is deliberately SAFE (codex's own trust prompt + approvals +
# sandbox all apply). For engine-launched seats the LAUNCHER appends
# --dangerously-bypass-approvals-and-sandbox — and ONLY inside a rendered
# crate wall (an unwallable codex seat refuses to boot). Codex's own macOS
# sandbox is Seatbelt and cannot nest inside the crate wall, so the wall is
# the containment; the bypass also skips the first-run "trust this folder?"
# gate and per-command approval stalls for unattended team use. 2.0 projects
# are LOCAL (no ssh from the seat), so the old ssh rationale is gone.
echo "codex${1:+ --model $1}"
