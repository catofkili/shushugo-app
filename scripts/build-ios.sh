#!/bin/bash
# 收集日 iOS - 一键构建脚本

set -e

echo "🚀 收集日 iOS 构建脚本"
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
#
# ⚠️ 按锁文件装,而且**不因为 node_modules 已存在就跳过**。原来是「看见目录就跳过,
# 否则 npm install --legacy-peer-deps」—— 一份几个月前的 node_modules 会和
# package-lock.json 悄悄对不上,而这条正是打给 App Store 的那条路。
echo -e "${YELLOW}📦 按锁文件安装前端依赖...${NC}"
npm ci --legacy-peer-deps

# 2. 质量门禁。⚠️ 发版这条路不许绕过 —— 类型错误和坏掉的出厂库在这里挡住,
# 比在审核或用户机上发现便宜得多(npm run build 的 prebuild 会校验出厂库)。
# 只在应急时用 SKIP_RELEASE_GATES=1 跳过,并且要知道自己跳过了什么。
if [ "${SKIP_RELEASE_GATES:-0}" != "1" ]; then
    echo -e "${YELLOW}🧪 类型 / lint / 测试...${NC}"
    npm run check
    npm run lint
    npm test
else
    echo -e "${RED}⚠️  已跳过类型/lint/测试(SKIP_RELEASE_GATES=1)${NC}"
fi

# 3. 构建前端
#
# ⚠️ 实验功能（开口练习，见 docs/DAILY_TALK_SPEC.md §0）不许进发版包：环境变量打开了就拒绝，
# 构建完再搜一遍它的指纹字符串兜底。上线时连同这两处一起删。
if [ -n "${SHUSHUGO_EXP_TALK:-}" ]; then
    echo -e "${RED}❌ SHUSHUGO_EXP_TALK 是实验功能开关，发版构建不许带${NC}"
    exit 1
fi
if [ -n "${SHUSHUGO_EXP_SPELLING:-}" ]; then
    echo -e "${RED}❌ SHUSHUGO_EXP_SPELLING 是实验功能开关，发版构建不许带${NC}"
    exit 1
fi
echo -e "${YELLOW}🔨 构建前端项目...${NC}"
npm run build
if grep -rq "__SHUSHUGO_EXP_TALK__" dist; then
    echo -e "${RED}❌ 构建产物里有实验功能（开口练习）的代码${NC}"
    exit 1
fi
if grep -rq "__SHUSHUGO_EXP_SPELLING__" dist; then
    echo -e "${RED}❌ 构建产物里有实验功能（单词拼写）的代码${NC}"
    exit 1
fi

# 4. 同步到 iOS
echo -e "${YELLOW}📱 同步到 iOS 项目...${NC}"
npx cap sync ios

# 5. 安装 iOS 依赖
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
