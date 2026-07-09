# 上架准备清单 (App Store Readiness)

> 总体判断：**功能约 85% 完成，可上架约 65%**。功能层面已相当完整（19 个页面、离线词库、SRS 调度、内购框架、云同步、通知、涂鸦笔等）。当前缺口主要不是“代码写到一半”，而是 App Store Connect / Cloudflare 部署 / 真机验证等收尾事项。
>
> 优先级：**P0 = 不解决就上不了 / 会被打回**，**P1 = 审核风险**，**P2 = 质量打磨**。
> 最近更新：2026-07-06

> 当前代码检查：`npm run check` 通过，`npm test` 通过（7 个测试文件 / 56 个断言），`npm run build` 通过（生产构建已 tree-shake 掉 `console.log` 与诊断探针），`npx wrangler deploy --dry-run` 通过。

---

## P0 — 上架阻断项

- [x] **纳入 git 版本控制** — 已完成（`git init`，`.gitignore` 排除 node_modules/dist/Pods/旧拷贝/zip，`package-lock.json` 已锁定）。
- [ ] **内购合规（Guideline 3.1.2）** — 代码侧已补大部分说明，外部配置仍待完成
  - [ ] Paywall 展示从 Store 拉取的**真实本地化价格**（当前 `purchases.ts` 的 `STORE_PRODUCTS` 价格写死为"App Store 定价"）。
  - [x] 订阅页补齐：自动续订说明、订阅周期说明、隐私政策链接、服务条款 (EULA) 链接。
  - [ ] App Store Connect 配置并过审三个产品：`master_pro_yearly` / `master_pro_monthly` / `master_pro_lifetime`。
  - [x] 提供"恢复购买" — `restorePurchases()` 已实现。
- [ ] **隐私合规**
  - [x] App 内隐私政策改为共享内容源（`privacy-policy-content.ts`）。
  - [x] Cloudflare Worker 提供 `GET /privacy` 公开页面代码，dry-run 打包通过。
  - [ ] 部署 Cloudflare Worker，确认 `/privacy` 为**公开可访问的 URL**，填入 App Store Connect。
  - [ ] 填写 Privacy Nutrition Label（数据收集类型）。
- [x] **后端去留决策** — 当前走 Cloudflare Worker 云同步路线，旧 `backend/server.py` 仅作历史/本地参考，不作为生产后端。
- [x] **账号删除入口（Guideline 5.1.1(v)）** — 已补 App 内删除云同步账号入口和 Worker `POST /api/auth/delete-account`。
- [x] **开发模式 Pro 已隔离** — 已核实：`grantPro` / `developmentUnlock` / DevTools 全部在 `import.meta.env.DEV` 守卫后，生产构建里这些入口不渲染且解锁函数直接失败，默认权益为免费版。无需再手动关闭。

## P1 — 审核风险 / 易被挑刺

- [ ] **最小功能性（Guideline 4.2）** — 纯 WebView 壳是审查重点。功能丰富+离线大概率可过，但需准备截图与说明证明非"套壳网站"。
- [ ] **Pro 权益与收据链路真机验证** — App 已有 StoreKit 框架、恢复购买和云端权益同步代码，但仍需 TestFlight/真机确认购买、恢复购买、订阅过期和云端同步是否完整走通。
- [x] **Info.plist 设备能力** — `UIRequiredDeviceCapabilities` 已从 `armv7` 调整为 `arm64`。
- [ ] **Info.plist 隐私权限复查** — 若涂鸦笔导出涉及相册/相机，需补 `NS...UsageDescription`，否则调用即崩。
- [ ] **App 图标确认** — 当前 appiconset 仅 `AppIcon-512@2x.png`，确认 `Contents.json` 配成 Xcode 单尺寸 1024 模式。

## P2 — 质量打磨

- [x] **补自动化测试** — 已覆盖 SRS 调度（`scheduler/priority.ts`）、自适应记忆（`adaptive.ts`）、权益与过期（`entitlements.ts`）、内购 expiry 解析（`purchases.ts`）、词单导入（`word-list-import.ts`）。当前 `npm test` 为 7 个测试文件 / 56 个断言通过。
- [x] **清理仓库杂物** — 已完成：移除历史调试草稿，删除旧构建拷贝 `master-nihongo/` 与 `master-nihongo.zip`，根目录整理 + 新增 README。
- [ ] **真机适配验证** — `scrollEnabled:false` + `contentInset:'never'`，需在带刘海/灵动岛的真机及各尺寸 + iPad 验证安全区。
- [ ] **涂鸦笔 canvas 上限** — 画布必须固定一屏视口（绑定整页会超 iOS canvas 上限失效），确保全页面遵守。

---

## 建议推进顺序

1. ~~git 版本控制~~ ✅（地基已稳）
2. ~~仓库整理~~ ✅
3. ~~补测试与基础合规文案~~ ✅
4. 部署 Cloudflare Worker，拿到公开隐私政策 URL
5. App Store Connect 配置内购商品与 Privacy Nutrition Label
6. TestFlight 真机验证：购买、恢复购买、删除账号、云同步、隐私政策链接、Filesystem 持久化的升级迁移
7. 准备上架构建（开发模式 Pro 已隔离，无需额外关闭）
