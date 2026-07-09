# Master 日语 (Master Nihongo)

一款离线优先的日语学习 iOS 应用：单词（N5–N1）、系统语法、智能复习（记忆曲线）、错题本、沉浸式学习与学习统计。

技术栈：React 19 + TypeScript + Vite + Tailwind，本地数据库用 SQLite（sql.js / WASM），通过 Capacitor 打包到 iOS。

## 仓库结构

```
frontend/            主应用（Web 源码 + Capacitor iOS 工程）
  src/               React 源码（pages / components / hooks / lib）
  public/nihongo.db  App 自带初始词库/语法库
  ios/App/           Xcode 工程（App.xcworkspace）
cloudflare-sync/     正式云端：Cloudflare Worker + D1 + KV
backend/             Legacy FastAPI 同步原型，当前不作为正式后端
docs/                指南与文档（见下）
scripts/             构建/数据处理脚本
```

> 数据：约 10,000+ 单词（N5–N1）、语法点与例句，完全离线可用。正式 App 使用本仓库内的 seed database 和 seed JSON。

## 快速开始

```bash
cd frontend
npm install
npm run dev          # 浏览器开发预览
npm run build        # 构建到 dist/
npx cap sync ios     # 同步到 iOS 工程
npm run ios          # 用 Xcode 打开（App.xcworkspace）
```

详见 [docs/QUICK_START.md](docs/QUICK_START.md) 与 [docs/XCODE_GUIDE.md](docs/XCODE_GUIDE.md)。

## 文档

| 文档 | 用途 |
|------|------|
| [docs/APP_STORE_READINESS.md](docs/APP_STORE_READINESS.md) | **上架准备清单（P0/P1/P2 路线图）** |
| [docs/DATABASES.md](docs/DATABASES.md) | 本地 SQLite、Cloudflare D1、legacy 后端边界 |
| [docs/PACKAGING.md](docs/PACKAGING.md) | 对外发包白名单与词库打包规则 |
| [docs/QUICK_START.md](docs/QUICK_START.md) | 本地运行 |
| [docs/XCODE_GUIDE.md](docs/XCODE_GUIDE.md) | Xcode 构建与真机调试 |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) / [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | 分发与部署 |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | 测试流程 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 问题排查 |
| [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) | 项目总结 |

## 已知状态

- **Pro 解锁工具仅在开发构建可用**：DevTools 面板和"本地临时解锁 Pro"都在 `import.meta.env.DEV` 守卫后，生产构建默认免费版，无需上架前手动关闭。
- 剩余上架收尾集中在**外部配置与真机验证**（App Store Connect 内购商品、部署 Worker 拿公开隐私政策 URL、Privacy Nutrition Label、TestFlight 验证购买/恢复/删除账号/云同步）。详见 [docs/APP_STORE_READINESS.md](docs/APP_STORE_READINESS.md)。
- 本地进度持久化在原生平台使用 Capacitor Filesystem 三代轮转（`main`/`tmp`/`prev`），从旧的 Preferences 分块存储自动迁移；改动后需 Xcode 重新构建到真机验证升级路径。
- 云同步 Worker 在 `cloudflare-sync/`；部署前需 `npm run d1:migrate:remote` 应用 `0004_auth_hardening` 迁移。
- 旧版 learning app 已归档到 `legacy-learning-app` 分支，仅作历史参考；正式开发与打包都以 `main` 为准。详见 [docs/LEGACY_ARCHIVE.md](docs/LEGACY_ARCHIVE.md)。
