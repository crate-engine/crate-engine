#!/usr/bin/env bash
# agy launch — prints the command to type into the station pane.
# Contract: launch.sh <model> <project> -> echoes one shell command line.
# --model VERIFIED against the shipping binary's --help (agy 1.1.14, 2026-08-18).
# NEVER add agy's own --sandbox here: inside a crate wall both are Seatbelt and
# Seatbelt does not nest.
echo "agy${1:+ --model $1}"
