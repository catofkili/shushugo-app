#!/bin/bash

# iOS WebView 优化插件安装脚本
# 用于安装所需的 Capacitor 插件

set -e  # 遇到错误立即退出

echo "🔧 开始安装 iOS WebView 优化插件..."

# 进入前端目录
cd "$(dirname "$0")/../frontend"

echo ""
echo "📦 安装 Capacitor 状态栏插件..."
npm install @capacitor/status-bar --legacy-peer-deps

echo ""
echo "📦 安装 Capacitor 键盘插件..."
npm install @capacitor/keyboard --legacy-peer-deps

echo ""
echo "📦 安装 Capacitor 启动画面插件..."
npm install @capacitor/splash-screen --legacy-peer-deps

echo ""
echo "🔄 同步到 iOS 项目..."
npm run sync

echo ""
echo "✅ 所有插件安装完成！"
echo ""
echo "📝 下一步："
echo "1. 重新构建前端: npm run build"
echo "2. 同步到 iOS: npm run sync"
echo "3. 在 Xcode 中运行测试"
