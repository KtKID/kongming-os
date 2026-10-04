#!/usr/bin/env bash
# 从 Kongming 启动 DSH cli profile；全部参数交给支持的 dsh 入口。
set -euo pipefail
KMH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$KMH_ROOT/scripts/kmh.mjs" cli "$@"
