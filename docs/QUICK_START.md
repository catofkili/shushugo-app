# 🚀 快速开始指南

## 5分钟启动应用

### 1️⃣ 配置环境（只需一次）

```bash
cd ~/Documents/master-nihongo-ios
./scripts/setup-xcode.sh
```

按提示完成 CocoaPods 安装。

### 2️⃣ 安装 iOS 依赖

```bash
cd frontend/ios/App
pod install
cd ../../..
```

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
pod deintegrate
pod install
```

### 问题：构建失败
```bash
# 清理重来
cd frontend
rm -rf node_modules ios dist
npm install --legacy-peer-deps
npm run build
npx cap add ios
cd ios/App && pod install
```

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
- 未来支持云端同步

## 🔄 更新代码后重新构建

```bash
cd ~/Documents/master-nihongo-ios/frontend
npm run build
npx cap sync ios
```

然后在 Xcode 中重新运行。

## 📚 更多帮助

- 详细指南：`docs/XCODE_GUIDE.md`
- 项目总览：`PROJECT_SUMMARY.md`
- 主文档：`README.md`
