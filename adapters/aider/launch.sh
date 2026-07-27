#!/usr/bin/env bash
# aider launch — prints the command to type into the station pane.
# Contract: launch.sh <model> <project> -> echoes one shell command line.
# CONFIRM the model flag against your installed aider version.
echo "aider${1:+ --model $1}"
