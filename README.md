# Master 日语 (Master Nihongo)

一款离线优先的日语学习 iOS 应用：单词（N5–N1）、系统语法、智能复习（记忆曲线）、错题本、沉浸式学习与学习统计。

技术栈：React 19 + TypeScript + Vite + Tailwind，本地数据库用 SQLite（sql.js / WASM），通过 Capacitor 打包到 iOS。

## 仓库结构

```
frontend/            主应用（Web 源码 + Capacitor iOS 工程）
  src/               React 源码（pages / components / hooks / lib）
  public/nihongo.db  打包进 App 的种子词库/语法库（~3 MB）
  ios/App/           Xcode 工程（App.xcworkspace）
backend/             可选的云同步服务（FastAPI，当前未接入 App）
docs/                指南与文档（见下）
docs/archive/        历史调试草稿，仅作留档，可忽略
scripts/             构建/数据处理脚本
```

> 数据：约 8,000 单词（N5–N1）、181 个语法点、数千例句，完全离线可用。

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
| [docs/QUICK_START.md](docs/QUICK_START.md) | 本地运行 |
| [docs/XCODE_GUIDE.md](docs/XCODE_GUIDE.md) | Xcode 构建与真机调试 |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) / [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | 分发与部署 |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | 测试流程 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 问题排查 |
| [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) | 项目总结 |

## 已知状态

- **开发模式默认开启 Pro 权限**（便于测试），上架前需关闭，详见上架清单。
- 内购、云同步尚未完成合规收尾，详见 [docs/APP_STORE_READINESS.md](docs/APP_STORE_READINESS.md)。
