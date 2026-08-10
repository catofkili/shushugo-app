# 上架准备清单 (App Store Readiness)

> 最近更新：**2026-08-10**（上一版停在 2026-07-06，与实际情况已严重脱节，本次整体重写）
>
> 总体判断：**功能基本完整，可上架约 75%**。
> 上一版给的是 65%，涨的是代码和测试，掉的是它当时**完全没有计入的版权账**——
> 2026-08-04 的内容审计确认词条与中文释义适用 CC BY-NC 4.0，**带内购上架 = 违约**。
> 这是目前唯一的硬阻塞，其余缺口都是外部配置和真机验证，不是「代码写到一半」。
>
> 优先级：**P0 = 不解决就上不了 / 会被打回**，**P1 = 审核风险**，**P2 = 质量打磨**。

## 当前代码检查（2026-08-10 实测）

| 项 | 结果 |
|---|---|
| `npm run check`（tsc --noEmit） | ✅ 通过 |
| `npm test` | ✅ 28 个测试文件 / 223 个用例，连跑 8 次稳定 |
| `npm run build` | ✅ 通过，主 bundle 632 kB（gzip 214 kB） |
| 出厂词库 `public/nihongo.db` | 10,919 词条，10,720 条有例句，用户数据表全空（白名单守卫生效） |

> 注意：跑测试要在 `frontend/` 目录下。在仓库根目录跑 `vitest` 会把
> `.claude/worktrees/` 里的旧副本一起扫进去，出现一堆假失败。

---

## P0 — 上架阻断项

### 🔴 内容版权（唯一的硬阻塞）

详见 [docs/CONTENT_RIGHTS.md](CONTENT_RIGHTS.md)。核心事实：词条、中文释义来自
[eggrolls-JLPT10k-v3.5](https://github.com/5mdld/anki-jlpt-decks)，适用 **CC BY-NC 4.0**，
明确禁止整合进付费产品。**NC 会传染给改编作品**——照着原文改写仍是改编，改多改少一样。

- [x] **例句**：10,609 条种子例句已逐词手写重做（2026-08-05）
- [x] **中文释义（长的那批）**：5,163 条旧释义 >5 字的已独立撰写（2026-08-10）。
      创作输入只有词条 ID、日语词形、假名、词性，不读旧中文；批次原文与方法说明
      留在 `manual-meaning-rewrite/`，那是「独立创作」的证据链，**不要删**
- [ ] **中文释义（短的那批）**：约 3,000 条 ≤5 字的没动。单条短译（`高校→高中`）
      基本没有独创空间，风险低，但**不能证明独立**
- [ ] **词表本身**：挑哪 10,609 个词、怎么编排，属于汇编，仍是上游的
- [ ] **JLPT 分级**：仍是上游标注。建议换成词频分级（语料词频是事实数据，有免费来源），
      既绕开标注又更有依据
- [ ] **给上游作者发商业授权邮件** ← **性价比最高的一步，成本几乎为零**。
      作者用 BY-NC 说明保留了商业权利，也就有权单独授权。顺便问清他的数据哪来的
- [ ] 备选路径：拿 **JMdict**（CC BY-SA 4.0，明确允许商用）重建词表 + 自己落中文。
      BY-SA 要求派生词典数据同许可公开，**但不禁止卖 App**，比 NC 的「根本不能卖」好谈

### 🔴 内购合规（Guideline 3.1.2）

- [x] 订阅页有自动续订说明、订阅周期、隐私政策链接、服务条款链接
- [x] `restorePurchases()` 已实现
- [ ] **Paywall 显示真实本地化价格** — `purchases.ts` 的 `STORE_PRODUCTS` 三个商品
      价格仍写死为字符串 `"App Store 定价"`，必须改成从 Store 拉
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
- [x] 后端去留：走 Cloudflare Worker，旧 `backend/server.py` 仅作历史参考
- [x] 开发模式 Pro 已隔离在 `import.meta.env.DEV` 守卫后（生产构建不渲染这些入口）

---

## P1 — 审核风险 / 易被挑刺

- [ ] **最小功能性（Guideline 4.2）** — 纯 WebView 壳是审查重点。功能丰富 + 完全离线
      大概率能过，但要准备截图和说明证明不是「套壳网站」
- [ ] **Pro 权益与收据链路真机验证** — StoreKit 框架、恢复购买、云端权益同步代码都在，
      但需要 TestFlight 真机确认购买、恢复、订阅过期、云端同步完整走通
- [ ] **真机适配** — `scrollEnabled:false` + `contentInset:'never'`，需在带刘海/灵动岛的
      真机及各尺寸 + iPad 验证安全区
- [x] `UIRequiredDeviceCapabilities` 已从 `armv7` 调整为 `arm64`
- [x] 隐私清单 `PrivacyInfo.xcprivacy` 已创建并接入 Xcode 工程
- [x] 订阅续订链路：StoreKit 在 App 启动时初始化，服务端 Apple 校验支持
      production→sandbox 回退（TestFlight/审核走沙盒）
- [x] 云同步要求邮箱已验证才能 push/pull（邮件服务未配置时豁免）
- [ ] **App 图标** — appiconset 只有 `AppIcon-512@2x.png`，`Contents.json` 已配成
      Xcode 单尺寸 1024 模式，需真机确认渲染正常
- [ ] **第三方署名** — About 页保留三个 VOICEVOX 署名（春日部つむぎ / 雨晴はう /
      玄野武宏），确认没有把原始 AAC 作为可下载素材包再分发
- [ ] **KANJIDIC2 的 CC BY-SA 义务** — 现在就已生效，不是上架才管。派生的汉字读音
      数据是否需要按 BY-SA 公开，需确认

---

## P2 — 质量打磨

- [x] 自动化测试：28 文件 / 223 用例，覆盖 FSRS 调度、优先级、排片序列、干扰隔离、
      学习模式、词单导入、权益与内购解析
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

- 当前分支 `feat/fsrs-sync-accounts` **领先 main 21 个提交，且全部未推送**
- Cloudflare Worker 名字仍是 `master-nihongo-sync`（项目已改名收集日），
  改名会换 URL，建议在拿隐私政策 URL **之前**决定
