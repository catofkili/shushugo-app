#!/bin/bash

# Master 日语 iOS 应用 - 快速启动脚本
# 用于清理缓存并重新启动应用

set -e

echo "🚀 Master 日语 iOS 应用 - 快速启动"
echo "=================================="
echo ""

# 项目目录
PROJECT_DIR="$HOME/Documents/master-nihongo-ios/frontend"
cd "$PROJECT_DIR"

# 1. 清理缓存
echo "🧹 清理缓存..."
rm -rf node_modules/.vite 2>/dev/null || true
rm -rf dist 2>/dev/null || true
echo "✅ 缓存已清理"
echo ""

# 2. 构建前端
echo "📦 构建前端..."
npm run build
echo "✅ 前端构建完成"
echo ""

# 3. 同步到 iOS
echo "🔄 同步到 iOS..."
npx cap sync ios
echo "✅ 同步完成"
echo ""

# 4. 检查模拟器
echo "📱 检查模拟器状态..."
BOOTED=$(xcrun simctl list devices | grep "Booted" | head -1)
if [ -z "$BOOTED" ]; then
    echo "启动 iPhone 17 模拟器..."
    xcrun simctl boot "iPhone 17" 2>/dev/null || true
    open -a Simulator
    sleep 5
fi
echo "✅ 模拟器已就绪"
echo ""

# 5. 卸载旧版本
echo "🗑️  卸载旧版本..."
xcrun simctl uninstall booted com.masternihongo.app 2>/dev/null || echo "没有旧版本"
echo ""

# 6. 构建并安装
echo "🔨 构建 iOS 应用..."
xcodebuild -workspace ios/App/App.xcworkspace \
    -scheme App \
    -configuration Debug \
    -destination 'platform=iOS Simulator,name=iPhone 17' \
    -derivedDataPath build \
    clean build \
    | grep -E "(BUILD|SUCCEEDED|FAILED|error:)" | tail -5

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "✅ 构建成功"
else
    echo "❌ 构建失败"
    exit 1
fi
echo ""

# 7. 安装应用
echo "📲 安装应用..."
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app
echo "✅ 应用已安装"
echo ""

# 8. 启动应用
echo "🎯 启动应用..."
xcrun simctl launch booted com.masternihongo.app
echo "✅ 应用已启动"
echo ""

echo "=================================="
echo "✅ 完成！应用正在模拟器中运行"
echo ""
echo "📋 测试清单："
echo "  1. 点击底部「我的」标签"
echo "  2. 测试所有 7 个功能页面"
echo "  3. 确认按钮可以点击和跳转"
echo "  4. 测试返回按钮"
echo ""
echo "🌐 或在浏览器中测试："
echo "  http://localhost:5173"
echo ""
