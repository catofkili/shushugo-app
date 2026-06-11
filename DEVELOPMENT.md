# 开发指南

## 项目结构说明

```
New project/
├── server.py              # 后端服务器主程序
├── seed_words.py          # 词汇数据种子
├── seed_grammar.py        # 语法数据种子
├── backend_selfcheck.py   # 后端自检脚本
├── remind.py              # 提醒功能脚本
│
├── src/                   # 前端源代码
│   ├── App.tsx           # React 主应用
│   ├── main.tsx          # 应用入口
│   ├── components/       # React 组件
│   ├── pages/            # 页面组件
│   ├── hooks/            # 自定义 Hooks
│   └── types/            # TypeScript 类型定义
│
├── static/               # 静态资源（生成后的前端）
├── data/                 # 数据文件
├── tools/                # 工具脚本
│
├── japanese_words.sqlite3  # 主数据库
├── archive_backups/      # 旧备份文件
└── backups/              # 数据库备份（由 backup.sh 生成）
```

## 开发工作流

### 1. 首次设置

```bash
# 克隆或进入项目目录
cd "/Users/lsc/Documents/New project"

# 创建 Python 虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装 Python 依赖
pip install -r requirements.txt

# 安装前端依赖
npm install
```

### 2. 日常开发

**启动开发服务器：**
```bash
./dev.sh
```
这会同时启动：
- 后端服务器（端口 8800）
- 前端开发服务器（端口 5173，带热重载）

**只启动后端：**
```bash
source .venv/bin/activate
python3 server.py
```

**只启动前端：**
```bash
npm run dev
```

### 3. 生产模式

```bash
# 构建前端
npm run build

# 启动应用
./start.sh
```

## API 端点

后端服务器提供以下 API：

### 词汇相关
- `GET /api/next` - 获取下一个学习单词
- `POST /api/answer` - 提交答案
- `GET /api/stats` - 获取学习统计
- `GET /api/review` - 获取待复习单词
- `GET /api/mistakes` - 获取错题本

### 语法相关
- `GET /api/grammar/list` - 获取语法点列表
- `GET /api/grammar/:id` - 获取语法点详情
- `POST /api/grammar/review` - 提交语法练习

## 数据库说明

### 主要数据表

1. **words** - 词汇表
   - id, kana, kanji, meaning, pos, examples
   
2. **grammar_points** - 语法点
   - id, title, level, explanation, examples

3. **progress** - 学习进度
   - word_id, stage, score, last_reviewed

4. **reviews** - 复习记录
   - word_id, reviewed_on, answer, score_delta

5. **grammar_progress** - 语法学习进度
   - grammar_id, mastery_level, review_count

### 备份数据库

```bash
# 手动备份
./backup.sh

# 或直接复制
cp japanese_words.sqlite3 backup_$(date +%Y%m%d).sqlite3
```

## VS Code 开发

项目已配置 VS Code 设置：

- Python 解释器自动识别（.venv）
- 调试配置（F5 启动服务器）
- 文件排除规则
- 代码格式化设置

### 调试服务器
1. 打开 VS Code
2. 按 F5 或选择"运行和调试"
3. 选择"Python: 启动服务器"

## 代码规范

### Python
- 缩进：4 空格
- 命名：snake_case
- 类型提示：推荐使用
- 文档字符串：推荐添加

### TypeScript/React
- 缩进：2 空格
- 命名：camelCase（函数/变量）、PascalCase（组件）
- 类型：严格类型检查
- 组件：函数式组件 + Hooks

## 常见任务

### 添加新词汇
编辑 `seed_words.py`，然后运行：
```bash
python3 backend_selfcheck.py
```

### 添加新语法点
编辑 `seed_grammar.py`，然后运行：
```bash
python3 backend_selfcheck.py
```

### 重置学习进度
```bash
python3 -c "import sqlite3; conn = sqlite3.connect('japanese_words.sqlite3'); conn.execute('DELETE FROM progress'); conn.commit()"
```

### 查看数据库统计
```bash
python3 -c "import sqlite3; conn = sqlite3.connect('japanese_words.sqlite3'); print(conn.execute('SELECT COUNT(*) FROM words').fetchone()[0], '个单词')"
```

### 导入 JLPT 词库
```bash
python3 import_eggrolls_jlpt.py
```

## 测试

```bash
# TypeScript 类型检查
npm run check

# Python 语法检查
python3 -m py_compile server.py
```

## 部署

### 本地部署
```bash
./start.sh
```

### 数据迁移
1. 备份当前数据库：`./backup.sh`
2. 复制 `japanese_words.sqlite3` 到新环境
3. 安装依赖并启动

## 故障排除

### 端口被占用
```bash
# 查找占用端口的进程
lsof -i :8800
# 杀掉进程
kill -9 <PID>
```

### 数据库损坏
```bash
# 检查完整性
sqlite3 japanese_words.sqlite3 "PRAGMA integrity_check;"

# 恢复备份
cp backups/japanese_words_XXXXXX.sqlite3 japanese_words.sqlite3
```

### 虚拟环境问题
```bash
# 删除重建
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 贡献指南

1. 创建新分支进行开发
2. 编写清晰的提交信息
3. 测试功能是否正常
4. 更新相关文档

## 许可证

词库数据遵循 CC BY-NC 4.0 许可（非商业使用）。

---
最后更新: 2026-06-11
