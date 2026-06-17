# Xcode 运行指南

## 🎯 正确的选择

在 Xcode 顶部工具栏：

### 左边（Scheme）
选择：**App**

### 右边（Device）
选择：**iPhone 17**（或任何 iPhone 模拟器）

完整显示应该是：
```
App > iPhone 17
```

## 📋 详细步骤

1. **打开项目**
   ```bash
   open ~/Documents/master-nihongo-ios/frontend/ios/App/App.xcworkspace
   ```

2. **在 Xcode 中**
   
   看顶部工具栏中间位置：
   ```
   [停止按钮]  [App ▼] > [iPhone 17 ▼]  [播放按钮 ▶️]
   ```

3. **点击 "App" 确认**
   - 如果显示的不是 "App"，点击下拉菜单
   - 选择 "App"（通常只有这一个选项）

4. **点击设备名称**
   - 点击 ">" 右边的设备名
   - 会弹出设备列表
   - 选择任意 iPhone 模拟器，比如：
     - iPhone 17 ✅
     - iPhone 17 Pro ✅
     - iPhone 15 Pro ✅

5. **点击播放按钮 ▶️**
   - 或按快捷键 `⌘R`
   - 等待构建完成
   - 模拟器会自动弹出

## 🔍 常见问题

### 问题 1: 看不到 "App" 选项
**原因**: 可能打开了 `.xcodeproj` 而不是 `.xcworkspace`

**解决**:
```bash
# 关闭 Xcode，重新打开正确的文件
open ~/Documents/master-nihongo-ios/frontend/ios/App/App.xcworkspace
```

### 问题 2: 设备列表是空的
**原因**: 没有安装模拟器

**解决**:
- Xcode > Settings > Platforms
- 下载 iOS 模拟器

### 问题 3: 构建失败
**解决**:
1. 清理构建: `Product > Clean Build Folder` (`Shift+⌘+K`)
2. 重新运行

## 📸 识别方法

正确的顶部工具栏应该显示：

```
┌────────────────────────────────────────┐
│  ◼️  App ▼  >  iPhone 17 ▼   ▶️      │
│      ↑              ↑          ↑       │
│    Scheme        Device      Run      │
└────────────────────────────────────────┘
```

- **Scheme (左边)**: 一定是 **App**
- **Device (右边)**: 选择任意 **iPhone 模拟器**
- **不要选**: 
  - ❌ "My Mac"
  - ❌ "Any iOS Device"
  - ❌ 真机（除非你连接了真实的 iPhone）

## ✅ 验证

选择正确后：
1. 点击 ▶️ 运行按钮
2. 看底部进度条：显示 "Building..."
3. 等待几秒到几十秒
4. 模拟器窗口会自动弹出
5. 应用会自动启动

## 🎬 快速启动命令

如果 Xcode 太复杂，用这个脚本：

```bash
cd ~/Documents/master-nihongo-ios
./scripts/quick-start.sh
```

这个脚本会：
- 自动构建
- 自动启动模拟器
- 自动安装应用
- 自动打开应用

---

**总结**: 选择 **App > iPhone 17**，然后点击 ▶️
