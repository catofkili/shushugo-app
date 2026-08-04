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

> 数据：约 10,000+ 单词（N5–N1）、语法点与例句，完全离线可用。正式 App 使用本仓库内的 seed database 和 seed JSON。

## 商业发布与版权合规（重要）

截至 **2026-08-04**，本仓库**没有声明所有内容已经完成版权清权，也不保证直接商用不会产生投诉、下架或法律争议**。本节和 [docs/CONTENT_RIGHTS.md](docs/CONTENT_RIGHTS.md) 是项目记录，不是版权许可、权利转让或法律意见；上架前不能只凭 README 作为授权证明。

### 例句改写记录

- `frontend/src/data/jlpt_words_seed.json` 当前包含 10,609 条种子词条例句；`frontend/public/nihongo.db` 实际包含 11,057 个词条，其中 10,993 条有日文例句。
- 截至 2026-08-04，按“不能证明为独立原创/可商业使用”的保守审计口径：9,932 条数据库例句仍能在已确认的上游例句中找到原句文本或去标点后的连续片段；其中 2,931 条只改了标点，4,631 条主要是在原文前加了「私は」，合计至少 7,562 条直接保留上游句子结构。
- 数据库另有 394 条有日文例句的词条无法在目前已确认的 eggrolls 来源中匹配出处。它们不一定就是侵权内容，但来源/原创性无法证明，也必须按版权风险项处理。因此，当前至少有 **10,326 条有例句的词条不能直接作为已清权的商业内容发布**（9,932 条已确认存在上游文本重合 + 394 条来源不明）；另有 667 条未发现与该上游例句连续重合，也不等于自动完成版权清权。64 个词条目前没有日文例句。
- 7,558 条中文例句翻译与已确认上游记录完全相同。**不能把当前例句表述为全部从零独立创作，也不能据此主张已脱离原数据许可证。**
- Git 历史中的导入脚本与旧项目 `DATA_SOURCE.md` 已确认：种子数据中的 10,609 条 JLPT 词条、中文释义和原例句来自 [eggrolls-JLPT10k-v3.5](https://github.com/5mdld/anki-jlpt-decks) 的 `deck-source/notes.csv`；生产数据库还包含未在该来源中逐条匹配的历史词条。上游采用 **CC BY-NC 4.0**，明确禁止把内容整合进付费产品或服务。**当前词库不能用于商业发行；必须取得上游商业授权，或整体替换所有未清权的词条、释义和例句数据。**
- 语法数据虽有从头改写的提交记录，但仍应在发布档案中保留作者、来源和版本记录。

### 已识别的第三方内容与发布条件

- `frontend/src/data/kanji_readings.json` 的元数据标明来源为 **KANJIDIC2**，许可为 **CC BY-SA 4.0**。发布时必须保留署名、许可链接及适用的相同方式共享义务。
- `frontend/src/data/kanji_variants.json` 使用 OpenCC 字典和 Unicode Unihan 等上游资料；必须按各上游许可补齐署名与许可文件。
- `frontend/public/audio/words/` 当前包含 `VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう` 和 `VOICEVOX:玄野武宏` 的预生成音频。发布时必须保留准确署名：`VOICEVOX:春日部つむぎ`、`VOICEVOX:雨晴はう`、`VOICEVOX:玄野武宏(CV:ガロ)`。按已核对的常规音声条款，三者均可在遵守各自规则并正确署名的前提下商用，当前没有青山龍星那种额外事前申请条件；仍不得把原始音频作为无关素材包或音声模型再分发。
- npm、Capacitor、iOS Pods 及其他第三方依赖各自适用其许可证；发布包需要保留并整理对应的 NOTICE/LICENSE 文件。
- 图标、截图、宣传视频、字体、图片、商标和 App Store 文案也属于发布审核范围，必须逐项确认原创、授权或适用的开放许可。

### 上架前必须完成

- [ ] 取得 eggrolls-JLPT10k 作者的商业授权，或整体替换 10,609 条已确认来自该来源的种子数据，并另行核查/替换数据库中 458 条未能与该来源匹配的历史词条；仅改标点、加主语或改少量措辞不能消除 CC BY-NC 限制。
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
