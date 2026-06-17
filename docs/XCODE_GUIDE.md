# Xcode 使用指南

## 🚀 快速开始

### 1. 配置环境
```bash
cd ~/Documents/master-nihongo-ios
./scripts/setup-xcode.sh
```

这个脚本会：
- 检查 Xcode 安装
- 切换到完整 Xcode（如果当前是命令行工具）
- 检查/安装 CocoaPods

### 2. 构建 iOS 项目
```bash
./scripts/build-ios.sh
```

这个脚本会：
- 安装前端依赖
- 构建前端代码
- 同步到 iOS 项目
- 安装 iOS 依赖（CocoaPods）

### 3. 打开 Xcode
```bash
cd frontend
npm run ios
# 或手动打开
open ios/App/App.xcworkspace
```

⚠️ **注意**: 必须打开 `.xcworkspace` 文件，不是 `.xcodeproj`

## 📱 在模拟器上测试

1. **选择模拟器**
   - 点击顶部工具栏设备选择器
   - 选择任意 iPhone 模拟器（推荐 iPhone 15 Pro）

2. **运行应用**
   - 点击播放按钮 ▶️ 或按 `⌘R`
   - 首次运行会自动下载和启动模拟器（需要几分钟）

3. **调试**
   - 使用 Safari > 开发 > 模拟器 > localhost 查看网页调试工具
   - Xcode 控制台查看原生日志

## 📱 在真机上测试（免费账号）

### 准备工作

1. **添加 Apple ID**
   - Xcode > Settings (⌘,)
   - 选择 "Accounts" 标签
   - 点击 "+" 添加 Apple ID
   - 登录你的 Apple ID（免费）

2. **配置签名**
   - 在 Xcode 左侧选中项目文件（蓝色图标）
   - 选择 "TARGETS" > "App"
   - 选择 "Signing & Capabilities" 标签
   - Team: 选择你的 Apple ID
   - Bundle Identifier: 保持默认或修改为唯一值

### 安装到 iPhone

1. **连接设备**
   - 用 USB 线连接 iPhone 到 Mac
   - 首次连接需要在 iPhone 上点击"信任"

2. **选择设备**
   - 点击顶部工具栏设备选择器
   - 选择你的 iPhone

3. **运行**
   - 点击播放按钮 ▶️ 或按 `⌘R`
   - Xcode 会自动安装到 iPhone

4. **信任开发者**（首次运行）
   - iPhone 会提示"未受信任的开发者"
   - 设置 > 通用 > VPN与设备管理
   - 点击你的 Apple ID
   - 点击"信任"
   - 返回主屏幕，重新打开应用

### 免费账号限制

- ✅ 可以在自己的设备上测试
- ⚠️ 应用每 7 天过期，需要重新安装
- ⚠️ 只能在 3 台设备上安装
- ❌ 不能发布到 App Store

**解决方案**: 每隔几天连接 Mac 重新运行一次即可刷新

## 🐛 常见问题

### 问题1: "xcode-select: error: tool 'xcodebuild' requires Xcode"

**解决**:
```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcode-select --reset
```

### 问题2: "No provisioning profiles found"

**解决**:
1. 打开 Xcode > Settings > Accounts
2. 选择你的 Apple ID
3. 点击 "Download Manual Profiles"
4. 或者在 Signing & Capabilities 中重新选择 Team

### 问题3: "Code Signing Error"

**解决**:
1. 修改 Bundle ID 为唯一值（如 `com.yourname.masternihongo`）
2. 确保选择了正确的 Team
3. 勾选 "Automatically manage signing"

### 问题4: CocoaPods 相关错误

**解决**:
```bash
cd frontend/ios/App
pod deintegrate
pod install
```

### 问题5: 模拟器启动失败

**解决**:
```bash
# 重置模拟器
xcrun simctl erase all

# 或重启 Xcode
killall Xcode
```

### 问题6: "App installation failed"

**解决**:
1. 清理构建: Product > Clean Build Folder (⇧⌘K)
2. 删除 derived data:
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData/*
   ```
3. 重新运行

## 🎨 修改应用图标和启动画面

### 应用图标

1. 准备图标（1024x1024 PNG）
2. 在 Xcode 中找到 Assets.xcassets
3. 点击 "AppIcon"
4. 拖拽图标到各个尺寸槽位
5. 或使用工具自动生成: https://appicon.co/

### 启动画面（Splash Screen）

1. 在 Xcode 中找到 Assets.xcassets
2. 点击 "Splash"
3. 拖拽启动图片
4. 或修改 `ios/App/App/Base.lproj/LaunchScreen.storyboard`

## 📊 性能优化

### 减小应用体积

1. 移除未使用的资源
2. 启用 Bitcode（可选）
3. 使用 Asset Catalogs 压缩图片

### 提升启动速度

1. 延迟加载大型数据库
2. 优化图片资源
3. 减少启动时的网络请求

## 🔐 隐私权限

如果应用需要访问：
- 相机
- 相册
- 位置
- 通知

需要在 `Info.plist` 中添加使用说明。

## 📱 测试清单

- [ ] 在模拟器上测试各个功能
- [ ] 在真机上测试性能
- [ ] 测试离线功能
- [ ] 测试数据保存和恢复
- [ ] 测试应用切换（后台/前台）
- [ ] 测试不同 iOS 版本
- [ ] 测试不同设备尺寸

## 📚 更多资源

- [Xcode 官方文档](https://developer.apple.com/xcode/)
- [iOS 开发者文档](https://developer.apple.com/documentation/)
- [Capacitor iOS 文档](https://capacitorjs.com/docs/ios)
