# 收集日公开官网

`website/` 是 `shushugo.com` 根域的静态首页，和 `frontend/` 学习 App 分开。这样官网可被搜索引擎收录，也不会改变用户在 5173 上的学习页、数据库来源或现有 GitHub Pages 的 `/shushugo-app/` 路径。

## 本地预览

在此目录运行 `python3 -m http.server 5199 --bind 127.0.0.1`，打开 `http://127.0.0.1:5199/`。不要用 5173 预览官网。页面不依赖 Node 或构建步骤。

## 内容与素材

- 主 CTA 暂时指向已可访问的网页学习 App：`https://catofkili.github.io/shushugo-app/`。迁移学习 App 域名时须先设计同源 IndexedDB 数据迁移与入口兼容，不能只替换链接。
- `assets/` 的水豚 WebP 图来自本仓库 `frontend/public/brand/sheet/`，这些切图由用户在 `~/收集日/未命名文件夹/` 的源图整理而来；小程序复用现有品牌图。
- 功能说明与小程序 `features/about/index` 对齐；平台公开状态只按已验证发布情况描述，不以仓库源码或本地编译代替上线验收。

## 发布

官网使用独立 Cloudflare Pages 项目 `shushugo-website`，生产分支名 `main`。在仓库根目录运行：

```bash
cloudflare-sync/node_modules/.bin/wrangler pages deploy website --project-name shushugo-website --branch main
```

Cloudflare Pages 自定义域名绑定到 `shushugo.com`；`api.shushugo.com` 仍指向现有 Worker。发布后检查主页、样式、图片、`robots.txt`、`sitemap.xml` 和网页学习 CTA。部署是单独的外部操作，不会由本仓库当前的 GitHub Pages 工作流自动完成。

不要把 Pages 项目命名为 `shushugo-home`：现有 `api.shushugo.com` Worker 已用这个服务名。根域目前是代理模式的 CNAME，目标为 `shushugo-website.pages.dev`；改动 DNS 前先核对 `api.shushugo.com` 的 Worker 路由。
