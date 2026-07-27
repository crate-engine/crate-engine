#!/usr/bin/env bash
# gemini launch — prints the command to type into the station pane.
# Contract: launch.sh <model> <project> -> echoes one shell command line.
# CONFIRM the model flag against your installed gemini version.
echo "gemini${1:+ --model $1}"
