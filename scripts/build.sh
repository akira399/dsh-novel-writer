#!/bin/bash
# dsh-novel-writer host build: compile src/ -> lib/ with the project-local tsc.
# (dev_build_plugin compatible: runs `bash scripts/build.sh`, then `build:client`.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TSC="./node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  echo "build: tsc not found; run 'npm install' first (node_modules/.bin/tsc)" >&2
  exit 1
fi

echo "=== Compiling src -> lib ==="
"$TSC" -p tsconfig.build.json
echo "=== Build complete (lib/) ==="
