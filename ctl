#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

usage() {
  cat <<EOF
用法：./ctl <命令>

命令：
  start        启动服务（后台运行）
  stop         停止服务
  restart      重启服务
  status       查看服务状态
  -h, --help   显示本帮助

示例：
  ./ctl start
  ./ctl restart

兼容：仍接受 --start、--stop、--restart、--status。
EOF
}

case "${1:-}" in
  start|--start)      npm run service:start ;;
  stop|--stop)        npm run service:stop ;;
  restart|--restart)  npm run service:restart ;;
  status|--status)    npm run service:status ;;
  -h|--help)  usage ;;
  "")         echo "错误：缺少命令参数。"; echo; usage; exit 1 ;;
  *)          echo "错误：未知命令 '$1'。"; echo; usage; exit 1 ;;
esac
