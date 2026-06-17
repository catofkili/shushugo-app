# 上架准备清单 (App Store Readiness)

> 总体判断：**功能约 80% 完成，可上架约 50%**。功能层面已相当完整（19 个页面、离线词库、SRS 调度、内购框架、通知、涂鸦笔等），缺口主要在工程成熟度与上架合规。
>
> 优先级：**P0 = 不解决就上不了 / 会被打回**，**P1 = 审核风险**，**P2 = 质量打磨**。
> 最近更新：2026-06-17

---

## P0 — 上架阻断项

- [x] **纳入 git 版本控制** — 已完成（`git init`，`.gitignore` 排除 node_modules/dist/Pods/旧拷贝/zip，`package-lock.json` 已锁定）。
- [ ] **内购合规（Guideline 3.1.2）** — *已决定暂缓，待后续处理*
  - [ ] Paywall 展示从 Store 拉取的**真实本地化价格**（当前 `purchases.ts` 的 `STORE_PRODUCTS` 价格写死为"App Store 定价"）。
  - [ ] 订阅页补齐：自动续订说明、订阅周期/价格、隐私政策链接、服务条款 (EULA) 链接。
  - [ ] App Store Connect 配置并过审三个产品：`master_pro_yearly` / `master_pro_monthly` / `master_pro_lifetime`。
  - [x] 提供"恢复购买" — `restorePurchases()` 已实现。
- [ ] **隐私合规**
  - [ ] 把 `PrivacyPolicy.tsx` 的内容托管成**公开可访问的 URL**，填入 App Store Connect。
  - [ ] 填写 Privacy Nutrition Label（数据收集类型）。
- [ ] **后端去留决策** — *已决定暂缓，待后续处理*
  - [ ] 若不上云同步：删除所有"云同步/备份"宣传文案与相关代码引用（否则审核判功能不完整）。
  - [ ] 若上云同步：`backend/server.py` 修复——`SECRET_KEY` 当前为默认占位值、`CORS allow_origins=["*"]`、SQLite 单文件，均不可用于生产。
- [ ] **关闭开发模式默认 Pro** — App 当前默认开启 Pro 权限供测试（见 README "已知状态"），上架前必须关闭。

## P1 — 审核风险 / 易被挑刺

- [ ] **最小功能性（Guideline 4.2）** — 纯 WebView 壳是审查重点。功能丰富+离线大概率可过，但需准备截图与说明证明非"套壳网站"。
- [ ] **Pro 权益仅存 localStorage**（`entitlements.ts`），无服务端/收据校验，可被绕过。v1 可接受，需知悉风险。
- [ ] **Info.plist 检查** — 若涂鸦笔导出涉及相册/相机，需补 `NS...UsageDescription`，否则调用即崩。
- [ ] **App 图标确认** — 当前 appiconset 仅 `AppIcon-512@2x.png`，确认 `Contents.json` 配成 Xcode 单尺寸 1024 模式。

## P2 — 质量打磨

- [ ] **补自动化测试** — 当前 0 测试。优先覆盖 SRS 调度（`scheduler/priority.ts`、`adaptive.ts`）与内购/权益逻辑。
- [x] **清理仓库杂物** — 已完成：归档 33 个调试草稿到 `docs/archive/`，删除旧构建拷贝 `master-nihongo/` 与 `master-nihongo.zip`，根目录整理 + 新增 README。
- [ ] **真机适配验证** — `scrollEnabled:false` + `contentInset:'never'`，需在带刘海/灵动岛的真机及各尺寸 + iPad 验证安全区。
- [ ] **涂鸦笔 canvas 上限** — 画布必须固定一屏视口（绑定整页会超 iOS canvas 上限失效），确保全页面遵守。

---

## 建议推进顺序

1. ~~git 版本控制~~ ✅（地基已稳）
2. ~~仓库整理~~ ✅
3. （暂缓）内购合规收尾
4. （暂缓）隐私政策托管 + Privacy Label
5. （暂缓）后端去留决策
6. 补测试、真机适配验证、关闭开发模式 Pro
