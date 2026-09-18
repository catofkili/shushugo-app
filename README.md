# 收集日 (ShuShuGo)

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

> 数据：约 10,000+ 单词（N5–N1）、语法点与逐词手写例句，完全离线可用。正式 App 使用本仓库内的 seed database 和 seed JSON。

## 商业发布与版权合规（重要）

截至 **2026-08-05**，本仓库**没有声明所有内容已经完成版权清权，也不保证直接商用不会产生投诉、下架或法律争议**。本节和 [docs/CONTENT_RIGHTS.md](docs/CONTENT_RIGHTS.md) 是项目记录，不是版权许可、权利转让或法律意见；上架前不能只凭 README 作为授权证明。

### 例句改写记录

- 2026-08-05 已先清空此前批量生成的旧例句；截至第十批完成，`frontend/src/data/jlpt_words_seed.json` 的 10,609 条种子行均已有逐词手写例句。前两批分别记录在 `frontend/scripts/pilot_examples_100.json`、`frontend/scripts/pilot_examples_100_additional.json`，第三至第十批记录在 `frontend/src/data/manual_examples_batch_003.json`、`frontend/src/data/manual_examples_batch_004.json`、`frontend/src/data/manual_examples_batch_005.json`、`frontend/src/data/manual_examples_batch_006.json`、`frontend/src/data/manual_examples_batch_007.json`、`frontend/src/data/manual_examples_batch_008.json`、`frontend/src/data/manual_examples_batch_009.json`、`frontend/src/data/manual_examples_batch_010.json`。第十批包含 5,807 条按日语词形和假名去重的手写例句；种子表中表示同一词形的重复行复用对应例句。
- 例句由人工逐词写成，再使用项目已有的数据库同步流程写入数据库；没有运行旧的全量公式生成器。`rewrite-independent-examples.mjs` 仅作为历史审计材料，不能把它当作生产生成器。
- 例句仍需逐条审核自然度、词义对应和商业发布资格；例句已经全部覆盖，不代表整个项目已经完成版权清权，也不保证“零版权风险”。
- ⚠️ **词条、中文释义、选词表已全部自建**（2026-09-06 确认）。此前记录的 eggrolls-JLPT10k / CC BY-NC 4.0 结论**已作废**，不再是上架阻塞；**不要再从 git 历史里把它翻出来重提**。溯源归档见 [docs/CONTENT_RIGHTS.md](docs/CONTENT_RIGHTS.md)。
- 🔴 **语法说明是目前唯一的内容版权阻塞**：源头是《蓝宝书》PDF 的 OCR（条目 id 前缀 `pdf-n*-`）。N1(201)、N2(150) 已从头重写；**N3(140)、N4(130)、N5(120) 共 390 条未重写**，不能随 App 商业发行。

### 已识别的第三方内容与发布条件

- `frontend/src/data/kanji_readings.json` 的元数据标明来源为 **KANJIDIC2**，许可为 **CC BY-SA 4.0**。发布时必须保留署名、许可链接及适用的相同方式共享义务。
- `frontend/src/data/kanji_variants.json` 使用 OpenCC 字典和 Unicode Unihan 等上游资料；必须按各上游许可补齐署名与许可文件。
- `frontend/public/audio/words/` 当前包含 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう` 和 `VOICEVOX:玄野武宏` 的预生成音频。发布时必须保留准确署名：`VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう`、`VOICEVOX:玄野武宏(CV:ガロ)`。按已核对的常规音声条款，三者均可在遵守各自规则并正确署名的前提下商用，当前没有青山龍星那种额外事前申请条件；仍不得把原始音频作为无关素材包或音声模型再分发。
- npm、Capacitor、iOS Pods 及其他第三方依赖各自适用其许可证；发布包需要保留并整理对应的 NOTICE/LICENSE 文件。
- 图标、截图、宣传视频、字体、图片、商标和 App Store 文案也属于发布审核范围，必须逐项确认原创、授权或适用的开放许可。

### 上架前必须完成

- [ ] **重写 N3/N4/N5 共 390 条语法说明**（源头是蓝宝书 PDF 的 OCR），或整体替换。方法沿用释义那次：创作输入只有句型、接续和等级，不读原书解释与例句，逐批留记录。⚠️ 改完要升 `GRAMMAR_SEED_VERSION`，而升版本前必须先把 `grammar_seed.json`(731) 与 `grammar.ts`(741) 对齐，否则新装用户会掉条目。
- [ ] 在 About 页面和对外发布页面保留准确的三个 VOICEVOX 署名：`VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう`、`VOICEVOX:玄野武宏(CV:ガロ)`；确认没有把原始 AAC 作为可下载素材包或音声模型再分发。
- [ ] 保留 KANJIDIC2、OpenCC、Unihan 及所有第三方依赖的许可和 NOTICE，并确认是否触发署名、相同方式共享或再分发义务。
- [ ] 检查生产包和 App Store 截图/预览/宣传材料，不要放入没有授权的第三方内容或商标表达。
- [ ] 把许可证、授权邮件、条款快照和数据生成记录归档，准备在 App Review 要求时提供。
- [ ] 根据销售国家/地区请专业律师或知识产权顾问做最终审查；许可证和角色条款可能在发布前发生变化。

详细清单见 [docs/CONTENT_RIGHTS.md](docs/CONTENT_RIGHTS.md)。

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
| [docs/CONTENT_RIGHTS.md](docs/CONTENT_RIGHTS.md) | **内容来源、许可证与商业发布审计清单** |
| [docs/GRAMMAR_FOUNDATION.md](docs/GRAMMAR_FOUNDATION.md) | **日语底层语法框架、与语法辞典的边界及来源审计** |
| [docs/WEEKLY_REPORT_PLAN.md](docs/WEEKLY_REPORT_PLAN.md) | **每周复习周报（二楼）开发规划** |
| [docs/WEEKLY_REPORT_DESIGN.md](docs/WEEKLY_REPORT_DESIGN.md) | 周报完整设计规格 |
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
- 云同步 Worker 在 `cloudflare-sync/`；部署前需 `npm run d1:migrate:remote` 应用迁移目录中的全部正式迁移（当前到 `0012_apple_notifications`）。
- 旧版 learning app 已归档到 `legacy-learning-app` 分支，仅作历史参考。当前完整产品线在 `feat/fsrs-sync-accounts`；截至 2026-09-11，`main` 仍停在 7 月 31 日的旧基线，缺少其后的 39 个提交，不能用于开发、构建或发布。恢复 `main` 前必须先审查并整合当前分支，不能仅因它是默认分支就切过去。详见 [docs/LEGACY_ARCHIVE.md](docs/LEGACY_ARCHIVE.md)。
