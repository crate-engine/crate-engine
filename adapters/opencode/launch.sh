#!/usr/bin/env bash
# opencode launch — prints the command to type into the station pane.
# Contract: launch.sh <model> <project> -> echoes one shell command line.
# CONFIRM the model flag against your installed opencode version.
echo "opencode${1:+ --model $1}"
