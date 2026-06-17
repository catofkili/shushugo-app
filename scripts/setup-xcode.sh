#!/bin/bash
# Xcode 环境配置脚本

echo "🔧 配置 Xcode 开发环境"
echo "======================"

# 1. 检查 Xcode 安装
if [ ! -d "/Applications/Xcode.app" ]; then
    echo "❌ 未找到 Xcode.app"
    echo "请从 App Store 安装 Xcode"
    exit 1
fi

echo "✅ Xcode 已安装"

# 2. 切换到完整 Xcode
CURRENT_PATH=$(xcode-select -p)
if [[ $CURRENT_PATH == *"CommandLineTools"* ]]; then
    echo "⚠️  当前使用命令行工具，切换到完整 Xcode..."
    sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
    echo "✅ 已切换到完整 Xcode"
else
    echo "✅ 已使用完整 Xcode"
fi

# 3. 验证配置
echo ""
echo "当前配置："
xcode-select -p
xcodebuild -version

# 4. 检查 CocoaPods
echo ""
if command -v pod &> /dev/null; then
    echo "✅ CocoaPods 已安装: $(pod --version)"
else
    echo "⚠️  CocoaPods 未安装"
    read -p "是否立即安装? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo gem install cocoapods
        echo "✅ CocoaPods 安装完成"
    fi
fi

echo ""
echo "✅ 环境配置完成！"
