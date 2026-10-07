#!/bin/bash
# KMH 统一启动入口；Web 后台服务管理与其余子命令透传。
#
#   ./kmh.sh start     彻底脱离当前终端/agent 会话启动 Web(setsid 新会话,
#                       不再随父进程退出被杀),监听 http://127.0.0.1:3080
#   ./kmh.sh stop      优雅停止(正常停止,不产生崩溃记录)
#   ./kmh.sh status    查看运行状态与崩溃记录概况
#   ./kmh.sh restart   stop 后重新 start
#   ./kmh.sh <子命令>  其余命令连同参数透传给 scripts/kmh.mjs,如
#                       ./kmh.sh web(前台启动 Web)、cli、sdk、setup、build
#
# 服务异常退出(被信号杀死、非零退出码)时,在 $KMH_HOME/logs/web-supervisor/ 下写一份独立
# 报告文件,一个问题一个文件:
#   crash-<时间>-<原因>-pid<PID>.md
# 正常 stop 不记录。完整运行日志在该目录的 web-server.log(每次 start 截断,
# 崩溃报告内嵌日志尾部,旧日志不会丢失关键信息)。
# 不做自动重启:进程挂了就停,由人看崩溃报告后决定何时再 start。

set -u

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
ROOT="$(cd "$(dirname "$0")" && pwd)"
KMH_HOME="$(node --input-type=module -e 'import { pathToFileURL } from "node:url"; const { resolveKmhHome } = await import(pathToFileURL(process.argv[1])); console.log(resolveKmhHome());' "$ROOT/scripts/runtime-home.mjs")" || exit 1
export KMH_HOME
ERROR_DIR="$KMH_HOME/logs/web-supervisor"
LOG_FILE="$ERROR_DIR/web-server.log"
PID_FILE="$ERROR_DIR/web.pid"
PORT="${KMH_WEB_PORT:-3080}"
KEEP_CRASH_FILES=50
TAIL_LINES=300

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

# 输出当前脚本的使用说明。
usage() {
  sed -n '4,10p' "$SELF" | sed 's/^# \{0,1\}//'
}

# 返回指定端口的第一个监听 PID；无监听时输出为空。
listener_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

# 输入信号编号，输出用于崩溃文件命名的名称。
sig_name() {
  case "$1" in
    1) echo SIGHUP ;;
    2) echo SIGINT ;;
    3) echo SIGQUIT ;;
    4) echo SIGILL ;;
    5) echo SIGTRAP ;;
    6) echo SIGABRT ;;
    8) echo SIGFPE ;;
    9) echo SIGKILL ;;
    10) echo SIGBUS ;;
    11) echo SIGSEGV ;;
    13) echo SIGPIPE ;;
    15) echo SIGTERM ;;
    *) echo "SIG${1}" ;;
  esac
}

# 输入秒数，输出运行时长。
fmt_uptime() {
  local s="$1" h m
  h=$((s / 3600)); m=$(((s % 3600) / 60)); s=$((s % 60))
  printf '%dh%02dm%02ds' "$h" "$m" "$s"
}

# 写崩溃报告:参数 = 启动器(node)PID、服务(node)PID、退出码、启动时间戳
write_crash_report() {
  local child_pid="$1" node_pid="$2" rc="$3" start_ts="$4"
  local end_ts ts reason file sig
  end_ts=$(date +%s)
  ts=$(date '+%Y%m%d-%H%M%S')
  if [ "$rc" -gt 128 ]; then
    sig=$((rc - 128))
    reason="signal${sig}-$(sig_name "$sig")"
  else
    reason="exit${rc}"
  fi
  file="$ERROR_DIR/crash-${ts}-${reason}-pid${node_pid:-$child_pid}.md"
  {
    echo "# KMH Web 异常退出记录"
    echo
    echo "- 时间:$(date '+%Y-%m-%d %H:%M:%S')"
    if [ "$rc" -gt 128 ]; then
      echo "- 退出:被信号杀死(signal $sig $(sig_name "$sig")),wait 状态码 $rc"
    else
      echo "- 退出:非零退出码 $rc(未捕获异常/启动失败等;若为启动器退出码,真实信号见日志尾部 ELIFECYCLE 行)"
    fi
    if [ -n "$node_pid" ]; then
      echo "- 服务进程 PID:$node_pid(node,与 lsof 端口一致)"
      echo "- 启动器 PID:$child_pid(node)"
    else
      echo "- 启动器 PID:$child_pid(node;服务 node PID 未及记录,启动即失败或极早期退出)"
    fi
    echo "- 本次运行时长:$(fmt_uptime $((end_ts - start_ts)))"
    echo "- 工作目录:$ROOT"
    echo "- 启动命令:node scripts/kmh.mjs web --no-open"
    echo
    echo "## 日志尾部(最近 $TAIL_LINES 行)"
    echo
    echo '```'
    tail -n "$TAIL_LINES" "$LOG_FILE" 2>/dev/null
    echo '```'
    echo
    echo "完整日志:$LOG_FILE(下次 start 时会被截断,如需留存请先复制)。"
  } > "$file"
  # 只保留最近的崩溃报告,防止目录无限增长
  ls -t "$ERROR_DIR"/crash-*.md 2>/dev/null | tail -n +"$((KEEP_CRASH_FILES + 1))" \
    | while IFS= read -r old; do rm -f "$old"; done
}

# 由 start 以新会话(setsid)拉起的守护逻辑:跑服务、等退出、归类退出原因
run_daemon() {
  umask 077
  mkdir -p "$ERROR_DIR"
  : > "$LOG_FILE"
  echo $$ > "$PID_FILE"

  STOPPING=0
  CHILD=""
  NODE_PID=""
  _term() {
    STOPPING=1
    # 对 KMH 启动器所在进程组整组发 TERM(同时通知启动器和服务子进程)
    if [ -n "$CHILD" ]; then
      kill -TERM -- "-$CHILD" 2>/dev/null || kill -TERM "$CHILD" 2>/dev/null
    fi
  }
  trap _term TERM INT

  START_TS=$(date +%s)
  {
    echo "=== KMH Web 启动 $(date '+%Y-%m-%d %H:%M:%S') supervisor pid $$ ==="
    echo "=== 命令:node scripts/kmh.mjs web --no-open  cwd:$ROOT ==="
  } >> "$LOG_FILE"

  # set -m:后台任务独立进程组,停止时可整组发信号,覆盖启动器和服务子进程
  set -m
  node "$ROOT/scripts/kmh.mjs" web --no-open >> "$LOG_FILE" 2>&1 &
  CHILD=$!

  # 轮询端口就绪后记录真正的服务进程 PID(供崩溃报告引用);启动失败则提前退出轮询
  i=1
  while [ "$i" -le 60 ]; do
    np=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1)
    if [ -n "$np" ]; then
      NODE_PID="$np"
      echo "=== 服务就绪 node pid $NODE_PID $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG_FILE"
      break
    fi
    kill -0 "$CHILD" 2>/dev/null || break
    sleep 1
    i=$((i + 1))
  done

  wait "$CHILD"
  RC=$?
  if [ "$STOPPING" = 1 ]; then
    wait "$CHILD" 2>/dev/null
    RC=$?
  fi
  rm -f "$PID_FILE"

  if [ "$STOPPING" = 1 ] || [ "$RC" -eq 0 ]; then
    echo "=== 正常退出 code=$RC $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG_FILE"
    exit 0
  fi
  write_crash_report "$CHILD" "$NODE_PID" "$RC" "$START_TS"
  exit "$RC"
}

# 建立独立 supervisor 会话并等待监听端口；占用或超时返回失败。
do_start() {
  local existing pid i
  existing=$(listener_pid)
  if [ -n "$existing" ]; then
    echo "端口 $PORT 已由 PID $existing 监听；请先核对现有服务。" >&2
    exit 1
  fi
  # setsid 拉起 supervisor:新会话、无控制终端,父 shell/agent 会话退出不影响
  /usr/bin/python3 -c '
import subprocess, sys
self, root = sys.argv[1], sys.argv[2]
try:
    p = subprocess.Popen(["/bin/bash", self, "__daemon"], cwd=root,
                         start_new_session=True,
                         stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
except Exception as e:
    print("拉起失败:", e, file=sys.stderr)
    sys.exit(1)
sys.exit(0)
' "$SELF" "$ROOT" || exit 1
  echo "已脱离会话启动,等待端口 $PORT 就绪(最长等 60 秒)..."
  for i in $(seq 1 60); do
    pid=$(listener_pid)
    if [ -n "$pid" ]; then
      echo "服务已就绪:http://127.0.0.1:$PORT(服务 PID $pid)"
      echo "崩溃记录目录:$ERROR_DIR"
      return 0
    fi
    sleep 1
  done
  echo "60 秒内端口仍未就绪,服务可能启动失败,查看日志:$LOG_FILE" >&2
  return 1
}

# 按受管 PID 与命令核对归属后停止进程组；归属缺失或超时返回失败。
do_stop() {
  local pid sup i np
  sup=""
  [ -f "$PID_FILE" ] && sup=$(cat "$PID_FILE" 2>/dev/null)
  pid=$(listener_pid)
  if [ -z "$pid" ] && { [ -z "$sup" ] || ! kill -0 "$sup" 2>/dev/null; }; then
    echo "未在运行。"
    rm -f "$PID_FILE"
    return 0
  fi
  pg=""
  if [ -n "$sup" ] && kill -0 "$sup" 2>/dev/null; then
    local supervisor_command
    supervisor_command=$(ps -o command= -p "$sup" 2>/dev/null)
    case "$supervisor_command" in
      *"/bin/bash $SELF __daemon"*) ;;
      *) echo "PID 文件与 supervisor 命令不匹配：$sup" >&2; return 1 ;;
    esac
    # 先 TERM supervisor:其 trap 会标记"有意停止"并对服务子树整组发 TERM
    echo "通知 supervisor(PID $sup)优雅停止整组服务..."
    kill -TERM "$sup" 2>/dev/null
  elif [ -n "$pid" ]; then
    echo "端口 $PORT 由 PID $pid 监听，受管 supervisor 已缺失；请手动核对进程后处理。" >&2
    return 1
  fi
  for i in $(seq 1 20); do
    np=$(listener_pid)
    if [ -z "$np" ] && { [ -z "$sup" ] || ! kill -0 "$sup" 2>/dev/null; }; then
      echo "已停止。"
      rm -f "$PID_FILE"
      return 0
    fi
    sleep 1
  done
  echo "停止等待超时；请检查 supervisor PID $sup 与日志 $LOG_FILE。" >&2
  return 1
}

# 输出端口监听、supervisor 与崩溃记录状态。
do_status() {
  local pid sup crashes latest
  pid=$(listener_pid)
  sup=""
  [ -f "$PID_FILE" ] && sup=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "运行中:http://127.0.0.1:$PORT(服务 PID $pid)"
    if [ -n "$sup" ] && kill -0 "$sup" 2>/dev/null; then
      echo "supervisor PID $sup(崩溃时写入 supervisor 目录)"
    fi
  else
    echo "未运行(端口 $PORT 无监听)。"
  fi
  crashes=$(ls "$ERROR_DIR"/crash-*.md 2>/dev/null | wc -l | tr -d ' ')
  latest=$(ls -t "$ERROR_DIR"/crash-*.md 2>/dev/null | head -n 1)
  if [ "${crashes:-0}" -gt 0 ]; then
    echo "崩溃记录:共 ${crashes} 份,最近:${latest#$ROOT/}"
  else
    echo "崩溃记录:无"
  fi
}

case "${1:-}" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop && do_start ;;
  status) do_status ;;
  __daemon) run_daemon ;;
  -h | --help | help | "") usage ;;
  *) exec node "$ROOT/scripts/kmh.mjs" "$@" ;;
esac
