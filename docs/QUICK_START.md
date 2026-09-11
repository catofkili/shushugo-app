# 🚀 快速开始指南

## 5分钟启动应用

### 1️⃣ 配置环境（只需一次）

```bash
cd ~/Documents/shushugo
./scripts/setup-xcode.sh
```

按提示完成 CocoaPods 安装。

### 2️⃣ 构建并同步 iOS 工程

```bash
cd /Users/lsc/Documents/shushugo
./scripts/build-ios.sh
```

脚本会按锁文件安装依赖、执行类型检查/lint/测试、构建 Web 资源、同步 Capacitor 并安装 Pods。已有 `frontend/ios` 包含原生配置，不要删除后重新 `cap add ios`。

### 3️⃣ 打开 Xcode

```bash
cd frontend
open ios/App/App.xcworkspace
```

### 4️⃣ 运行应用

1. 在 Xcode 顶部选择设备（模拟器或你的 iPhone）
2. 点击播放按钮 ▶️
3. 等待编译和启动

## 🎯 首次使用

### 在模拟器测试
- 选择任意 iPhone 模拟器（推荐 iPhone 15 Pro）
- 点击运行，自动启动模拟器

### 在真机测试
1. USB 连接 iPhone 到 Mac
2. iPhone 上点击"信任此电脑"
3. Xcode 中选择你的 iPhone
4. 点击运行
5. 如果提示"未受信任的开发者"：
   - iPhone: 设置 > 通用 > VPN与设备管理
   - 找到你的 Apple ID > 点击"信任"
   - 返回主屏幕重新打开应用

## ⚠️ 如果遇到问题

### 问题：找不到 Xcode
```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### 问题：CocoaPods 错误
```bash
sudo gem install cocoapods
cd frontend/ios/App
pod install
```

如果仍失败，先保留完整错误输出再定位；不要把删除整个 iOS 工程当作通用修复。

### 问题：构建失败
```bash
cd /Users/lsc/Documents/shushugo
./scripts/build-ios.sh
```

脚本停在哪一步，就修对应的类型、lint、测试、前端构建、Capacitor 或 CocoaPods 错误。不要用删除 `ios`、跳过测试或重新生成工程来掩盖错误。

## 📱 使用应用

### 词汇学习
- 进入"单词学习"
- 查看单词卡片
- 选择答案（忘记/模糊/认识/熟知）
- 系统自动保存进度

### 语法学习
- 进入"语法学习"
- 浏览语法点列表
- 点击查看详情和例句

### 学习进度
- 自动保存到本地
- 退出重开应用，进度保留
- 配置 `VITE_SYNC_API_URL` 并登录后可使用云同步；未配置、未登录或离线时仍以本地学习数据为准

## 🔄 更新代码后重新构建

```bash
cd /Users/lsc/Documents/shushugo
./scripts/build-ios.sh
```

然后在 Xcode 中重新运行。

## 📚 更多帮助

- 详细指南：[XCODE_GUIDE.md](XCODE_GUIDE.md)
- 项目总览：[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- 主文档：[README.md](../README.md)
