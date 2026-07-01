# 项目维护记录

## 2026-06-11 - 项目初始化与清理

### 完成的任务

✅ **清理与优化**
- 移动 12 个数据库备份文件到 `archive_backups/` (节省 6.8MB)
- 清理所有测试日志和运行日志
- 添加 favicon.ico 修复 404 错误
- 更新 .gitignore 配置

✅ **文档**
- 创建完整的 README.md
- 保留原有的 DATA_SOURCE.md 和 FRONTEND_README.md

✅ **Git 仓库**
- 初始化 Git 提交
- 提交 170 个文件
- 当前 2 个提交

✅ **工具脚本**
- `start.sh` - 快速启动脚本（生产模式）
- `dev.sh` - 开发模式（前后端同时运行）
- `maintenance.sh` - 项目维护脚本
- `run_reminder.sh` - 提醒功能脚本

✅ **配置文件**
- 添加 .editorconfig 统一代码风格

### 项目状态

- **项目大小**: 204MB
- **源代码文件**: 431 个 Python 文件 + 18 个 TypeScript 文件
- **数据库**: japanese_words.sqlite3 (~1MB)
- **词库**: JLPT N5-N3 约 2000 词

### 后续建议

1. **如果不需要备份**: 可以删除 `archive_backups/` 文件夹
2. **数据库备份**: 定期备份 `japanese_words.sqlite3`
3. **依赖更新**: 定期运行 `npm update` 和 `pip list --outdated`
4. **Git 配置**: 可以配置全局 Git 用户名和邮箱

### 快速开始

```bash
# 启动应用（生产模式）
./start.sh

# 开发模式（带热重载）
./dev.sh

# 项目维护
./maintenance.sh
```

---
维护记录由 Codex 生成
