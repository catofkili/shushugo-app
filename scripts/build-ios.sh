#!/bin/bash
# Master Nihongo iOS - 一键构建脚本

set -e

echo "🚀 Master Nihongo iOS 构建脚本"
echo "================================"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装${NC}"
    exit 1
fi

# 检查 Xcode
if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}❌ Xcode 未安装${NC}"
    exit 1
fi

# 检查 CocoaPods
if ! command -v pod &> /dev/null; then
    echo -e "${YELLOW}⚠️  CocoaPods 未安装，正在安装...${NC}"
    sudo gem install cocoapods
fi

# 切换到前端目录
cd frontend

# 1. 安装依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 安装前端依赖...${NC}"
    npm install --legacy-peer-deps
else
    echo -e "${GREEN}✅ 依赖已安装${NC}"
fi

# 2. 构建前端
echo -e "${YELLOW}🔨 构建前端项目...${NC}"
npm run build

# 3. 同步到 iOS
echo -e "${YELLOW}📱 同步到 iOS 项目...${NC}"
npx cap sync ios

# 4. 安装 iOS 依赖
if [ -f "ios/App/Podfile" ]; then
    echo -e "${YELLOW}📦 安装 iOS 依赖...${NC}"
    cd ios/App
    pod install
    cd ../..
fi

echo ""
echo -e "${GREEN}✅ 构建完成！${NC}"
echo ""
echo "下一步："
echo "1. 打开 Xcode: npm run ios"
echo "2. 或手动打开: open ios/App/App.xcworkspace"
echo "3. 连接 iPhone 或选择模拟器"
echo "4. 点击运行按钮 (⌘R)"
echo ""
