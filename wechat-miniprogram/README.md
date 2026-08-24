# 收集日微信小程序（离线首版开发中）

这是路线 A 的原生最小验证工程，不会启动或刷新现有 `frontend` 学习页面。
当前已经跑通的闭环是：`WXWebAssembly.instantiate` → `sql.js` → 词库下载/读取 → 今日计划 → 显示答案/三档作答 → FSRS 状态与 reviews 写回 → 自动原子保存 → 撤销/冷启动恢复。

词库、进度、复习流水都留在小程序自己的用户目录；页面不会读取 iOS/Chrome 的学习库。学习核心在 `src/core/study-core.js`，不依赖 `wx.*`，因此可以在 Node 对真实出厂库回归；同步通过 `src/runtime/sync-snapshot.js` 接入现有 Cloudflare Worker 的用户数据快照协议。

## 在微信开发者工具里运行

1. 用微信开发者工具打开本目录，`project.config.json` 的 `miniprogramRoot` 已指向 `src/`。
2. 在 `src/config.js` 填写已经备案并加入小程序业务域名白名单的内容 CDN 地址，例如：

   ```js
   module.exports = {
     seedDatabaseUrl: 'https://cdn.example.com/shushugo/nihongo.db',
     syncUrl: 'https://master-nihongo-sync.example.workers.dev',
     authUrl: 'https://master-nihongo-sync.example.workers.dev',
     entitlementUrl: 'https://master-nihongo-sync.example.workers.dev/api/entitlements',
     paymentUrl: 'https://pay.example.com'
   };
   ```

3. 真机调试时点击「初始化本地库」，首次会下载约 11MB 的 SQLite 词库到 `wx.env.USER_DATA_PATH`。
4. 数据更新、同步、备份、原子写盘和冷启动恢复在「设置与权益」页；学习首页只保留学习动作和产品入口。

开发者工具的本地调试可把 `seedDatabaseUrl` 留空，然后在 `src/config.js` 设置 `seedDatabasePath` 为代码包内的临时 seed 文件；正式包不要把 11MB 词库放进主包。

## 已完成的离线能力

- `npm run smoke` 用仓库真实 `frontend/public/nihongo.db` 完成查询、导出、重新打开和关键表校验。
- `npm run core-smoke` 对真实 10,919 词库验证新词计划、FSRS 作答、复习流水、笔记和安全撤销。
- `npm run sync-smoke` 对拍两份本地库，验证 review 自然键去重和进度合并不会重复插入。
- `npm run sync-snapshot-smoke` 验证与 Worker 同格式的 SQLite 用户快照、跨端合并和本地登录令牌剥离。
- `npm run runtime-smoke` 用 Node 模拟 `wx` 文件系统与 `WXWebAssembly`，验证两次原子保存后主库损坏能从 `.prev` 冷恢复。
- `npm run budget` 检查代码包不携带数据库/音频，当前源码包约 1.28 MiB（含音高重音、动词自他提示和表记判定数据）；11 MB 词库仍只走用户目录下载。
- `npm run check` 检查适配器、原子写盘和页面代码的关键约束，并比对表记数据与 iOS 端是否一致。
- 产品层已接上：经典/快速/错题/反向/汉字读音/自选六个入口；词库筛选、记忆色阶、批量熟知、收藏、笔记和详情；741 条本地语法；从真实词库现算的 1,912 组疑难辨析；47 个本地结算成就；统计、28 天学习日历、JLPT 进度地图、温泉打卡和图鉴。卡片还会显示音高重音、例句假名、词源、动词类型、例句词典和辨析提示。
- 首页已提供学习入口、查词库、语法、辨析、成就、旅程、账号绑定和权益入口；数据更新、同步、备份等维护动作已移到「设置与权益」，不再和学习卡混在一起。没有配置服务端时，同步/支付会明确保持不可用，不会伪造成功。

## 汉字读音方向：和 iOS 对齐的三件事

iOS 端把原来的「释义 → 汉字」改成了**汉字读音**（表记 → 读音），小程序这侧同步跟上，
否则两端写的是同一张 `kanji_reading_memory`，却在训练两种不同的题型：

1. **题面是表记，只遮汉字对应的那几拍**（`core/orthography.js` 的 `concealedReadingParts`）。
   中文母语者认得字，盲区在读音——把汉字也藏起来等于考错了东西。
2. **流水写 `reviews.direction = 'kanji_reading'`**。路由键仍叫 `kanji`（页面和本地
   `direction_tasks` 用它），但写进流水的字符串必须和 iOS 一致：写成 `'kanji'` 的话，
   iOS 会当成归档的旧题型，小程序答过的卡在那边不算「今天答过」，会被再问一遍。
3. **按表记优先级筛词**：`src/data/kanji_orthography.json` 是从 iOS 端拷来的同一份数据
   （165 条，源头是 `frontend/scripts/audit-kanji-orthography.mjs` + 人工判定文件）。
   不筛的话 コーヒー、ちょうど 这类本来就写假名的词也会被拿去考读音。
   **别在小程序这侧手改这个 JSON**：`npm run check` 会逐字节比对两份，不一致直接报错。

### 删除同步的兼容边界

快照层现在会把 iOS 的 `table_name/row_key` 和小程序的 `entity/natural_key` 映射成同一份双别名墓碑；导入 iOS 快照时会按删除时间清理小程序对应的 `progress`、方向记忆、任务、笔记、复习流水、打卡、收藏/状态等支持表，避免已合并的重复词重新出现。
仍有一条边界：iOS 侧尚未纳入小程序 schema 的语法高亮、语法阅读位置等表，当前只保留墓碑，不会凭空创建这些表；两端要完全覆盖这些表，仍需后续 schema 对齐。

疑难辨析当前小程序运行时得到 1,912 组，iOS 当前代码实测为 1,910 组（你截图里的 1,907 是更早口径）；主体算法和各类分布已对齐，剩余 2 组是重复异写/词根收口的细节差异，发布前需要逐组审计，不把这个数字差异藏掉。

## 内容更新与同步接口约定

内容 manifest 是小 JSON，不把大库塞进代码包：

```json
{
  "version": "2026-09-01-content-v2",
  "databaseUrl": "https://cdn.example.com/shushugo/nihongo.db",
  "expectedBytes": 11288576,
  "expectedWords": 10919
}
```

同步客户端已经对齐仓库内 `cloudflare-sync` Worker：

- `GET /api/sync/status`：读取账号的 generation/last_modified；
- `POST /api/sync/push`：以 `application/octet-stream` 上传 `master-nihongo-user-sqlite-v1`，当前小程序上传 `x-sync-compression: none`；
- `GET /api/sync/pull`：以二进制返回快照，能读取 Worker 的 `none` 或 `gzip`；
- 小程序先拉取并按行合并，再带 `x-sync-base-generation` 上传，避免首次绑定时覆盖云端；review 仍按 `word_id + created_at + direction` 去重，登录令牌和设备本地状态永不进入快照。
- 为了让 iOS 的 LWW 合并识别小程序刚刚答过的卡，快照会补充 `sync_updated_at/sync_origin_device` 两列（本地业务表不因此膨胀）；进度时间取 FSRS 最近复习时间，流水时间取 `created_at`。

Worker 的同步入口要求已验证账号（`requireVerifiedUser`）。小程序的微信 `wx.login`/`code2session` 代码路径已经接上，但仍需配置 Worker secrets 后，才可在真机打开账号同步与收费闭环。

`paymentPath` 默认是 `/api/pay/orders`，只接受服务端返回的完整 `wx.requestPayment` 参数，不在客户端生成签名或伪造支付成功；当前仓库的 Worker 仍只有 Apple 收据核验，微信支付商户下单、回调验签和权益发放需要另行配置后才会可用。

## 仍需要真机/外部系统才能完成的出口

- 微信开发者工具和 iOS/Android 真机：首次下载、WASM 初始化、冷启动恢复、原子写盘、峰值内存和 ruby/字体排版；
- 已备案 HTTPS 域名与业务域名白名单：内容 CDN 和同步接口；
- Worker 的微信登录已经有 `/api/auth/wechat` 代码路径；上线仍需在 Cloudflare secret 配置 `WECHAT_APP_ID/WECHAT_APP_SECRET`，并在微信公众平台完成小程序主体、业务域名和审核配置；支付下单/回调与审核资质仍必须由商户侧完成。

## 仍在继续的开发轨

下一步仍是把本目录的 `runtime` 适配器接到独立的 Taro 4 + React 18 工程（P0-B），并继续完善沉浸式语法阅读、例句 token 词典弹层、两端辨析组逐组对齐和真机排版/内存验证；这不会刷新或改写现有 iOS 学习页面。

## 第三方运行时

- `src/vendor/ts-fsrs.umd.js`：ts-fsrs，MIT License；
- `src/vendor/sql-wasm.js` 与 `src/assets/sql-wasm.wasm`：sql.js，MIT License。
