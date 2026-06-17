#!/bin/bash
# 部署到 Vercel/Netlify 的快速脚本

echo "🌐 准备部署 Web 版本..."
npm run build

echo ""
echo "✅ 构建完成！dist/ 文件夹已准备好"
echo ""
echo "📦 选择部署方式："
echo "1. Vercel（推荐）："
echo "   npm i -g vercel"
echo "   vercel deploy dist/"
echo ""
echo "2. Netlify："
echo "   npm i -g netlify-cli"
echo "   netlify deploy --prod --dir=dist"
echo ""
echo "3. GitHub Pages："
echo "   将 dist/ 内容推送到 gh-pages 分支"
