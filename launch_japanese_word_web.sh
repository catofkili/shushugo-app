#!/bin/zsh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

PORT=8000
URL="http://127.0.0.1:${PORT}/"
LOG_FILE="$PROJECT_DIR/server.run.log"
PYTHON_BIN="${PYTHON_BIN:-/opt/homebrew/bin/python3}"

notify() {
  osascript -e "display notification \"$1\" with title \"日语背词\"" >/dev/null 2>&1 || true
}

if curl -fsS "http://127.0.0.1:${PORT}/api/stats" >/dev/null 2>&1; then
  notify "后端已经在运行，正在打开网页。"
  open "$URL"
  exit 0
fi

OLD_PID="$(lsof -ti tcp:${PORT} 2>/dev/null | head -n 1)"
if [ -n "$OLD_PID" ]; then
  kill "$OLD_PID" 2>/dev/null
  sleep 1
fi

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3)"
fi

nohup "$PYTHON_BIN" "$PROJECT_DIR/server.py" > "$LOG_FILE" 2>&1 &

for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/stats" >/dev/null 2>&1; then
    notify "启动成功，正在打开网页。"
    open "$URL"
    exit 0
  fi
  sleep 0.2
done

notify "启动失败，请查看 server.run.log。"
open "$PROJECT_DIR"
exit 1
