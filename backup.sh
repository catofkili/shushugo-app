#!/bin/bash
# 数据库备份脚本

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

DB_FILE="japanese_words.sqlite3"
BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/japanese_words_$TIMESTAMP.sqlite3"

echo "📦 数据库备份工具"
echo ""

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 检查数据库文件
if [ ! -f "$DB_FILE" ]; then
    echo "❌ 数据库文件不存在: $DB_FILE"
    exit 1
fi

# 执行备份
echo "正在备份数据库..."
cp "$DB_FILE" "$BACKUP_FILE"

# 验证备份
if [ -f "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ 备份完成: $BACKUP_FILE ($SIZE)"

    # 列出所有备份
    echo ""
    echo "📋 现有备份:"
    ls -lh "$BACKUP_DIR"/*.sqlite3 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

    # 清理旧备份（保留最近5个）
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sqlite3 2>/dev/null | wc -l | xargs)
    if [ "$BACKUP_COUNT" -gt 5 ]; then
        echo ""
        echo "🧹 清理旧备份（保留最近5个）..."
        ls -t "$BACKUP_DIR"/*.sqlite3 | tail -n +6 | xargs rm -f
        echo "   已清理 $((BACKUP_COUNT - 5)) 个旧备份"
    fi
else
    echo "❌ 备份失败"
    exit 1
fi

echo ""
echo "✨ 备份完成！"
