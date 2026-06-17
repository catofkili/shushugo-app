# 📱 Master Nihongo - Windows 用户指南

## 🎉 欢迎！

这是一款功能完善的日语学习应用，压缩包已准备好，可以在 Windows 上解压使用！

---

## 📦 压缩包说明

### 1️⃣ master-nihongo-demo.zip (6.0M) ⭐ 推荐
**完整版 - 包含所有内容**
- ✅ Web 应用（可浏览器打开）
- ✅ iOS 项目文件（需要 Mac 电脑 + Xcode）
- ✅ 后端 API 代码
- ✅ 完整说明文档

### 2️⃣ master-nihongo-web-only.zip (2.8M)
**轻量版 - 只有 Web 应用**
- ✅ 可直接在浏览器运行
- ✅ 更小的文件体积
- ✅ 适合快速预览

---

## 🚀 Windows 快速启动指南

### 方式 1：使用 Python（推荐）

**步骤：**

1. **解压文件**
   ```
   右键点击 .zip 文件 → 解压到当前文件夹
   ```

2. **打开命令提示符 (CMD)**
   ```
   按 Win + R
   输入 cmd
   按回车
   ```

3. **进入解压目录**
   ```cmd
   cd master-nihongo-demo\frontend\dist
   ```

4. **启动本地服务器**
   ```cmd
   python -m http.server 8080
   ```
   
   或者（如果 python3 命令存在）：
   ```cmd
   python3 -m http.server 8080
   ```

5. **打开浏览器访问**
   ```
   http://localhost:8080
   ```

---

### 方式 2：使用 Node.js

**前提：** 需要安装 Node.js ([下载地址](https://nodejs.org/))

1. **解压文件**

2. **打开 CMD，进入目录**
   ```cmd
   cd master-nihongo-demo\frontend\dist
   ```

3. **安装简易服务器**
   ```cmd
   npm install -g serve
   ```

4. **启动应用**
   ```cmd
   serve -s .
   ```

5. **浏览器访问显示的地址**（通常是 http://localhost:3000）

---

### 方式 3：使用 VS Code（开发者推荐）

1. **安装 VS Code** ([下载地址](https://code.visualstudio.com/))

2. **安装 Live Server 插件**
   - 打开 VS Code
   - 点击左侧扩展图标
   - 搜索 "Live Server"
   - 点击安装

3. **打开项目**
   ```
   文件 → 打开文件夹 → 选择 master-nihongo-demo\frontend\dist
   ```

4. **启动服务**
   - 右键点击 index.html
   - 选择 "Open with Live Server"

---

## ⚠️ 常见问题

### Q1: 提示 "python 不是内部或外部命令"
**解决：** 
- 下载安装 Python：https://www.python.org/downloads/
- 安装时勾选 "Add Python to PATH"

### Q2: 双击 index.html 后页面空白
**原因：** 
- 现代浏览器的安全限制，需要通过 HTTP 服务器访问
- 必须使用上面的方式 1/2/3 启动

### Q3: 数据库无法加载
**解决：**
- 确保 nihongo.db 文件在 dist 目录下
- 使用 HTTP 服务器访问，不要直接双击 HTML

---

## ✨ 应用功能

### 🎯 核心功能
- **单词学习** - N5-N1 完整词库（8000+ 词）
- **语法学习** - 181 个语法点系统讲解
- **沉浸式学习** - 全屏专注模式
- **智能复习** - 记忆曲线复习系统
- **错题本** - 自动收集错题
- **学习统计** - 详细进度追踪

### 🎨 界面特性
- 深色/浅色主题切换
- 流畅动画效果
- 响应式设计（桌面/移动端）

### 💾 数据管理
- 完全离线使用
- 本地数据存储
- 支持数据导出/导入

---

## 🧪 测试模式

**已启用开发者模式：**
- ✅ 默认开启 Pro 权限
- ✅ 所有功能完全解锁
- ✅ 可在"我的"页面切换 Pro 开关

**试试这些功能：**
1. 切换主题（设置 → 主题模式）
2. 学习单词（单词学习 → 今日计划）
3. 浏览语法（语法 → 选择任意语法点）
4. 查看统计（工具箱 → 学习总览）
5. 沉浸式学习（语法详情页右上角）

---

## 📊 技术信息

- **前端框架**: React + TypeScript
- **数据库**: SQLite (3.0M)
- **完全离线**: 无需联网即可使用
- **支持浏览器**: Chrome, Edge, Firefox, Safari

---

## 💡 推荐浏览器

**Windows 用户推荐：**
1. ⭐ Microsoft Edge（最新版）
2. ⭐ Google Chrome
3. Firefox

---

## 📞 反馈建议

如果遇到问题或有改进建议，欢迎反馈！

---

**祝学习愉快！がんばって！** 🎌
