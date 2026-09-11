# 上架准备清单 (App Store Readiness)

> 最近更新：**2026-09-11**（测试数与付费代码状态按当前工作区复查；远端与真机状态未推断）
>
> ⚠️ **这一页只记「当天真跑出来的数」和「明确的是/否」。**
> 以前那句「可上架约 75%」已删：它没有可核验的口径，一个月后没人说得清
> 那 75% 是按什么算的，也没人能判断它涨没涨。缺口一条条列在下面，
> 每条要么是外部配置、要么是真机验证、要么是内容工作 —— 数缺口比数百分比诚实。
>
> 优先级：**P0 = 不解决就上不了 / 会被打回**，**P1 = 审核风险**，**P2 = 质量打磨**。

## 当前代码检查（2026-09-11 实测）

| 项 | 结果 |
|---|---|
| `npm run check`（tsc --noEmit） | ✅ 通过 |
| `npm run lint` | ✅ 0 error / 24 warning；剩余均为既有同步加载型 `set-state-in-effect`，依赖/ref/纯度警告已清理 |
| `npm test` | ✅ 88 个测试文件、632 个用例通过（另有 1 文件、23 个用例跳过） |
| `npm run build` | ✅ 通过，入口 JS 1,590 kB（gzip 496 kB）；语法块 1,177 kB、JLPT 种子块 11,235 kB 都是懒加载，不进首屏 |
| 出厂词库 `public/nihongo.db` | 10,919 词条，10,720 条有例句，741 条语法，用户数据表全空（白名单守卫生效） |
| 小程序 `npm test`（14 个脚本） | ✅ 全部通过 |
| Worker `npm run check` / `npm test` | ✅ 通过 |
| 最低支持系统 | **iOS 16.4**（2026-09-10 定；Podfile / Xcode / vite `build.target` 三处一致，理由见下） |

> 注意：跑前端测试要在 `frontend/` 目录下；仓库根目录没有前端 `package.json`。
> 2026-09-11 已移除两个旧附加 worktree，不能再把旧 worktree 的测试结果算进当前项目。
>
> ⚠️ **上面这些没有一条能代替真机验收**：Xcode 编译、TestFlight、内购、
> 通知、文件系统生命周期都还没在真机上走过。

---

## P0 — 上架阻断项

### 🔴 内容版权：只剩语法这一处

详见 [docs/CONTENT_RIGHTS.md](CONTENT_RIGHTS.md)。

- [x] **例句**：10,609 条种子例句已逐词手写重做（2026-08-05）
- [x] **中文释义**：已全部独立撰写。创作输入只有词条 ID、日语词形、假名、词性，
      不读旧中文；批次原文与方法说明留在 `manual-meaning-rewrite/`、
      `manual-meaning-polish/`、`question-meaning-review/`，那是「独立创作」的证据链，**不要删**
- [x] **词表本身（选哪些词、怎么编排）**：已自建
- [x] **语法的「文字层」已全部自建（2026-09-08）**：741 条解释 + 863 条例句逐条重写，
      批次记录在 `scripts/grammar-explanation-rewrites/`、`scripts/grammar-example-rewrites/`。
      上一版这里写的「N3/N4/N5 共 390 条未重写」已不成立
- [ ] 🔴 **语法的「选目层」仍未处理**：条目集合、切分方式、分级归属、排序，
      741 条全部沿用原书，`bookOrder` 就是 1~741 的全书连续序。
      **句型本身不受保护，受保护的是解释文字、例句和「选哪些、怎么编排」这份汇编** ——
      文字层做完了，汇编那一层还在。详见 [docs/CONTENT_RIGHTS.md](CONTENT_RIGHTS.md)
- [x] ⚠️ 「升 `GRAMMAR_SEED_VERSION` 会掉条目」这条已修（2026-09-08）：
      `grammar_seed.json` 和出厂库 `grammar_points` 现在都是 **741 行**、逐行同构，
      `verify-release-db.mjs` 逐行比对 13 个字段，差一行就拒绝构建

### 🔴 内购合规（Guideline 3.1.2）

- [x] 订阅页有自动续订说明、订阅周期、隐私政策链接、服务条款链接
- [x] `restorePurchases()` 已实现
- [x] **Paywall 读取 Store 的本地化价格** — 初始化后从商品 offer 的 pricing phase 读取，
      `"App Store 定价"` 只是在 Store 尚不可用时的非数字占位，不会伪造价格；仍需随下条
      App Store Connect 商品一起做真机显示验收
- [ ] App Store Connect 配置并过审三个商品：
      `shushugo_pro_yearly` / `shushugo_pro_monthly` / `shushugo_pro_lifetime`

### 🔴 隐私合规

- [x] App 内隐私政策走共享内容源 `privacy-policy-content.ts`
- [x] Worker 提供 `GET /privacy` 公开页面（`cloudflare-sync/src/index.ts`）
- [x] 账号删除入口 + Worker `POST /api/auth/delete-account`
- [ ] **部署 Cloudflare Worker**，确认 `/privacy` 是公开可访问 URL，填进 App Store Connect
      → `wrangler.jsonc` 已开 `workers_dev: true`，**用 `*.workers.dev` 子域就够，不需要自定义域名**
- [ ] 填写 Privacy Nutrition Label

### 其他

- [x] 纳入 git 版本控制，`.gitignore` 排除 node_modules/dist/Pods/音频目录
- [x] 后端去留：走 Cloudflare Worker，旧 `backend/server.py` 实现已删除，只保留 `backend/LEGACY.md` 说明
- [x] 开发模式 Pro 已隔离在 `import.meta.env.DEV` 守卫后（生产构建不渲染这些入口）

---

## P1 — 审核风险 / 易被挑刺

- [ ] **最小功能性（Guideline 4.2）** — 纯 WebView 壳是审查重点。功能丰富 + 完全离线
      大概率能过，但要准备截图和说明证明不是「套壳网站」
- [ ] **Pro 权益与收据链路真机验证** — StoreKit 框架、恢复购买、云端权益同步代码都在，
      但需要 TestFlight 真机确认购买、恢复、订阅过期、云端同步完整走通
- [ ] **真机适配** — `scrollEnabled:false` + `contentInset:'never'`，需在带刘海/灵动岛的
      真机及各尺寸 + iPad 验证安全区
- [x] **最低支持系统定为 iOS 16.4**（2026-09-10）。原来 Podfile / Xcode 写着 15.0，
      而 Vite 7 默认按 baseline（Safari 16）编译 —— iOS 15 的设备装得上、连 JS 都解析不了。
      取 16.4 而不是 16.0，是因为云备份的 gzip 解压直接用 `DecompressionStream`
      （Compression Streams，Safari/iOS 16.4 才有）：低于它的设备本地能学，
      **恢复不了云备份**，而那正是换设备时唯一要它工作的一刻。
      ⚠️ 三处必须一起改：`ios/App/Podfile`、Xcode 的 `IPHONEOS_DEPLOYMENT_TARGET`、
      `frontend/vite.config.ts` 的 `build.target`
- [x] `UIRequiredDeviceCapabilities` 已从 `armv7` 调整为 `arm64`
- [x] 隐私清单 `PrivacyInfo.xcprivacy` 已创建并接入 Xcode 工程
- [x] 订阅续订链路：StoreKit 在 App 启动时初始化；服务端支持 production→sandbox 回退，
      一日重查和 cron 使用当前订阅状态接口，可由旧交易 T1 找到漏通知的续费 T2
- [x] 云同步要求邮箱已验证才能 push/pull（邮件服务未配置时豁免）
- [ ] **App 图标** — appiconset 只有 `AppIcon-512@2x.png`，`Contents.json` 已配成
      Xcode 单尺寸 1024 模式，需真机确认渲染正常
- [ ] **第三方署名** — About 页保留三个 VOICEVOX 署名（春日部つむぎ / 雨晴はう /
      玄野武宏），确认没有把原始 AAC 作为可下载素材包再分发
- [ ] **KANJIDIC2 的 CC BY-SA 义务** — 现在就已生效，不是上架才管。派生的汉字读音
      数据是否需要按 BY-SA 公开，需确认

---

## P2 — 质量打磨

- [x] 自动化测试：88 文件 / 632 用例，覆盖 FSRS 调度、优先级、排片序列、干扰隔离、
      学习模式、词单导入、权益与内购解析、**落盘并发与增量回滚、内容迁移的整库落盘、
      备份恢复换设备号**（后三项是 2026-09-10 审查补的回归）
- [x] 仓库整理：设计稿与原型移出 `frontend/public/`，加了 public 数据库白名单守卫
- [ ] **199 条词条仍无例句**（10,720 / 10,919）
- [ ] **释义压缩过头抽查** — 重写时压到平均 4.2 字，把本来能区分的词压成了一样：
      `警察` 和 `警官` 现在都是「警察」，`探す`/`捜す` 都是「寻找」。日语里区别很清楚，
      是中文释义丢了信息
- [ ] **54 组纯异写该标为「同一个词」** — `繋がる`/`つながる`、`あさって`/`明後日`
      现在会被当成两个词分别考
- [ ] **种子里 10 组多义词被压平** — 整条流水线拿 `(kanji, kana)` 当唯一键，
      `本` 只留下「书本」，丢了「本……」那个义项。属于既有数据模型限制
- [ ] `data/grammar.ts` 1.2 MB 语法数据硬写在 .ts 里，应进 SQLite
      （已切成懒加载块，不进主包，所以不影响启动，但仍是包体积负担）
- [ ] `english_origins.json` 没有逐项来源和许可证元数据
- [ ] **依赖告警只在开发工具链上**（2026-09-11 实测）：`npm audit --omit=dev` 在
      frontend 和 cloudflare-sync **两边都是 0**。完整审计为前端 3 条
      （1 critical / 1 high / 1 low）、Worker 3 条 high，来自
      `@capacitor/cli → tar@6.2.1`（前端）和 `wrangler → miniflare → sharp`（Worker），
      都只在本机构建时跑。
      ⚠️ 前端不能执行 `npm audit fix --force`：它给的方案是 Capacitor 6 → 8
      跨大版本。Capacitor 的大版本迁移会动到原生存储路径
      （`Directory.Library` —— 那正是学习库所在的地方），拿它当「顺手修个告警」来做，
      风险远大于收益。Worker 当前可用普通 `npm audit fix` 更新传递依赖，本轮按机械依赖
      维护暂缓；要升前端就单独立一次，升完必须真机验证一遍持久化和升级迁移

---

## 已讨论并明确不做的

- **Android**：Capacitor 架构下加平台本身很便宜，但 Google Play 收据校验是纯新增的
  服务端工作（2–3 天），加上存储路径 `Directory.Library` 需要重新验证（丢数据风险）。
  合计 1–2 周。**iOS 先上架，版权工作两个平台共用，不浪费。**
- **UI 与多邻国的相似度**：核对过配色、吉祥物、核心视觉隐喻、游戏化机制，
  差异明显，不构成风险。
- **个人易混词对影响排片**：已决定不影响调度，独立开。

---

## 建议推进顺序

1. **发那封给上游作者的授权邮件** —— 成本几乎为零，成了的话 P0 的版权整块消失
2. **部署 Cloudflare Worker**，拿到公开隐私政策 URL（不依赖任何其他步骤，随时能做）
3. Paywall 接真实价格 + App Store Connect 配置内购商品与 Privacy Nutrition Label
4. 版权兜底方案并行推进：短释义 + 分级换词频口径 + JMdict 可行性评估
5. TestFlight 真机验证：购买、恢复购买、删除账号、云同步、隐私政策链接、
   Filesystem 持久化的升级迁移
6. 准备上架构建

## 遗留的工程债

- 按 2026-09-11 的本地 refs，当前分支 `feat/fsrs-sync-accounts` 领先 `main` 37 个提交、
  落后其远端跟踪分支 1 个提交，另有本轮未提交改动。推送前应先处理远端分歧并逐项暂存，
  不能把工作区整体 `git add .`
- **网页版（GitHub Pages）默认没有预生成读音音频**：那 137 MB 不在版本库里，
  干净 runner 上 checkout 完就没有，网页版会退回系统 TTS。
  workflow 现在支持 `AUDIO_ARTIFACT_URL` + `AUDIO_ARTIFACT_SHA256` 两个仓库变量
  （下载并核对校验和后解开），**制品本身还没有发布** —— 没配就在构建日志里告警，
  不再静默发一版没声音的
- Cloudflare Worker / D1 / R2 仍使用 `master-nihongo-sync` 等旧资源名，这是现有 URL、数据和
  配置的兼容标识，不属于漏改品牌。只有准备好 URL、远端数据和客户端配置迁移方案时才改
