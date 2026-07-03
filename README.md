# 日语学习应用

> **已废弃 / 只读归档**
>
> 这个分支保留的是早期 learning app 历史版本，仅用于查阅旧资料。
> 当前正式项目是 `main` 分支上的 **Master Nihongo iOS App**。
> 不要从这个分支打包、发布或继续开发新功能。

一个结合了词汇和语法学习的日语学习应用，支持间隔重复算法、错题本功能和每日提醒。

## 功能特性

### 词汇学习
- 📚 **词库管理**：包含 N5-N3 约 2000 个常用词汇
- 🎯 **智能复习**：基于艾宾浩斯遗忘曲线的间隔重复算法
- 📊 **学习统计**：追踪学习进度和复习情况
- ⚠️ **错题本**：自动收集错误单词，针对性复习
- 🔄 **词汇辨析**：自他动词配对、敬语体系等特殊提示
- 📝 **例句支持**：部分词汇包含示例句子

### 语法学习
- 📖 **语法点库**：系统化的日语语法点
- 💡 **对比学习**：相似语法点的对比表格
- ✅ **练习测验**：语法点练习和测试功能
- 📈 **进度跟踪**：记录学习和复习状态

### 系统功能
- ⏰ **每日提醒**：通过 macOS Calendar 提醒复习
- 🖥️ **本地运行**：无需联网，数据完全本地化
- 🌙 **学习日期**：凌晨 4 点前算作前一天（适应晚睡学习习惯）

## 技术栈

### 后端
- **Python 3** + SQLite3
- 简单的 HTTP 服务器（ThreadingHTTPServer）
- 数据库支持多表设计：单词、语法、进度、复习记录等

### 前端
- **React 19** + TypeScript
- **Vite** 构建工具
- **Tailwind CSS** 样式框架
- **Lucide React** 图标库

## 项目结构

```
.
├── server.py                  # 后端服务器主文件
├── seed_words.py             # 词汇种子数据
├── seed_grammar.py           # 语法种子数据
├── remind.py                 # 提醒脚本
├── backend_selfcheck.py      # 后端自检脚本
├── import_eggrolls_jlpt.py   # JLPT 词库导入工具
│
├── japanese_words.sqlite3    # 主数据库文件
│
├── src/                      # 前端源代码
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/          # React 组件
│   ├── pages/               # 页面组件
│   ├── hooks/               # React Hooks
│   └── types/               # TypeScript 类型定义
│
├── static/                   # 静态资源
├── data/                     # 数据文件（如汉字变体映射）
├── tools/                    # 工具脚本
│
├── package.json             # Node.js 依赖
├── requirements.txt         # Python 依赖
├── tsconfig.json           # TypeScript 配置
├── tailwind.config.js      # Tailwind 配置
└── vite.config.ts          # Vite 配置
```

## 安装与使用

### 1. 安装 Python 依赖

```bash
python3 -m venv .venv
source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

### 2. 安装 Node.js 依赖

```bash
npm install
```

### 3. 初始化数据库（如果需要）

```bash
python3 backend_selfcheck.py
```

### 4. 启动应用

**方式一：使用启动脚本**
```bash
./打开日语背词.command
```

**方式二：手动启动**
```bash
# 启动后端服务器
python3 server.py

# 在浏览器访问
open http://localhost:8800
```

### 5. 开发模式（前端）

```bash
npm run dev
```

## 数据来源

词库部分导入自 [eggrolls-JLPT10k-v3.5](https://github.com/5mdld/anki-jlpt-decks)
- 许可：CC BY-NC 4.0
- 用途：非商业个人学习

## 提醒功能设置

项目包含 macOS launchd 配置文件，可以设置定时提醒：

```bash
# 复制 plist 文件到 LaunchAgents
cp com.lsc.nihongo-reminder.plist ~/Library/LaunchAgents/

# 加载服务
launchctl load ~/Library/LaunchAgents/com.lsc.nihongo-reminder.plist
```

## 数据库表结构

主要表：
- `words` - 词汇表
- `progress` - 学习进度
- `reviews` - 复习记录
- `grammar_points` - 语法点
- `grammar_progress` - 语法学习进度
- `kanji_progress` - 汉字学习进度

## 维护说明

### 备份清理
数据库备份文件已移至 `archive_backups/` 目录，如不需要可以删除以节省空间。

### 日志文件
运行日志文件已配置在 `.gitignore` 中，会自动忽略。

## 开发计划

- [ ] 添加更多 N2/N1 词汇
- [ ] 完善语法点例句
- [ ] 优化间隔重复算法
- [ ] 添加语音朗读功能
- [ ] 支持自定义词库导入

## 许可

个人学习项目。词库数据遵循 CC BY-NC 4.0 许可。
