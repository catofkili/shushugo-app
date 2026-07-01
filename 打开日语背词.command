#!/bin/zsh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

close_terminal_window() {
  if [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
    (
      sleep 0.25
      osascript >/dev/null 2>&1 <<'APPLESCRIPT'
tell application "Terminal"
  if (count of windows) > 0 then close front window
end tell
APPLESCRIPT
    ) &!
  fi
}

trap close_terminal_window EXIT

/bin/zsh "$PROJECT_DIR/launch_japanese_word_web.sh"
