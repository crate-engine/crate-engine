#!/usr/bin/env bash
# Pi (pi.dev) launch — echoes the seat's harness command line.
# Contract: launch.sh <model> <project> -> echoes one shell command line.
# Pi runs where the runner runs, on the LOCAL project (2.x default).
# Model pins at launch (v0.79.x) via --model "provider/id" (e.g. openai/gpt-5.5).
# An EMPTY model launches bare pi, letting the /login session pick the provider.
# Auth: subscription (pi /login: ChatGPT/Claude/Copilot) or *_API_KEY env var.
MODEL="${1:-}"
if [ -n "$MODEL" ]; then
  echo "pi --model \"$MODEL\""
else
  echo "pi"
fi
