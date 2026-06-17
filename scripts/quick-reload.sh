#!/bin/bash

# 快速修复并重启 iOS 应用

set -e

cd ~/Documents/master-nihongo-ios/frontend

echo "🔨 构建前端..."
npm run build

echo "🔄 同步到 iOS..."
npx cap sync ios

echo "📱 卸载旧版本..."
xcrun simctl uninstall booted com.lsc.masternihongo 2>/dev/null || true

echo "📦 安装新版本..."
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app

echo "🚀 启动应用..."
xcrun simctl launch booted com.lsc.masternihongo

echo ""
echo "✅ 完成！"
echo "请在模拟器中检查底部导航栏是否正常显示"
