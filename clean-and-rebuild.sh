#!/usr/bin/env bash
set -euo pipefail

# iOS 应用完全清理和重新构建脚本

echo "🧹 开始清理 iOS 缓存..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/frontend"

# 1. 清理前端构建
echo "📦 清理前端构建目录..."
rm -rf dist
rm -rf node_modules/.vite

# 2. 清理 iOS 资源
echo "📱 清理 iOS 资源..."
rm -rf ios/App/App/public
rm -rf ios/App/build

# 3. 清理 Xcode 缓存
echo "🔨 清理 Xcode 缓存..."
rm -rf ~/Library/Developer/Xcode/DerivedData

# 4. 清理 CocoaPods 缓存
echo "☕ 清理 CocoaPods 缓存..."
cd ios/App
pod cache clean --all 2>/dev/null || echo "⚠️ Pod cache clean 跳过"
cd ../..

# 5. 重新构建
echo "🔄 重新构建前端..."
npm run build

# 6. 同步到 iOS
echo "📲 同步到 iOS..."
npx cap sync ios

echo ""
echo "✅ 清理和构建完成！"
echo ""
echo "📝 下一步操作："
echo "1. 打开 Xcode: npm run ios"
echo "2. 在 Xcode 中: Product > Clean Build Folder (⌘⇧K)"
echo "3. 完全退出模拟器应用"
echo "4. 在 Xcode 中重新运行 (⌘R)"
echo ""
