#!/usr/bin/env bash
# 把「今日 ML 任务」小组件装进 Übersicht。重复运行 = 更新课表，进度（~/.ml-today）不受影响。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/ml-today.widget"
DEST="$HOME/Library/Application Support/Übersicht/widgets"

if [ ! -d "/Applications/Übersicht.app" ]; then
  echo "没找到 Übersicht。先安装：brew install --cask ubersicht（或到 https://tracesof.net/uebersicht/ 下载），打开一次再重跑本脚本。"
  exit 1
fi

mkdir -p "$DEST" "$HOME/.ml-today"
rm -rf "$DEST/ml-today.widget"
cp -R "$SRC" "$DEST/ml-today.widget"
echo "已安装到 $DEST/ml-today.widget，Übersicht 会自动刷新。"
