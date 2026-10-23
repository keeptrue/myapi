#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f dist/server/main.mjs ]]; then
  echo "未找到构建产物 dist/server/main.mjs。先运行： bun install && bun run build" >&2
  exit 1
fi

exec node dist/server/main.mjs "$@"
