# 本地存储、落盘与迁移

## 落盘：整库最多 5 分钟一次，中间只写改过的行（2026-09-06）

`local-delta.ts` + `storage.ts`。以前 `scheduleSave` 是 2 秒 debounce 后**整库** export
再写下去 —— 真人节奏下等于每答一张卡就重写 35.9MB：浏览器端占住主线程 100~510ms，
原生端还要先 base64（36MB → 48MB 字符串）再走三代文件轮转。

现在：中间只写「上次整库快照之后改过的行」（实测 **每张卡约 0.9 KB**），
整库最多 5 分钟一次（`FULL_SNAPSHOT_INTERVAL_MS`）。

- **增量是白捡的**：云同步早就给每张用户表加了 `sync_updated_at`（触发器盖章）和
  `sync_tombstones`。这里没有第二套变更追踪，只是换个地方用同一份；回放也用同一套
  `beginSyncApply` 把触发器压住（回放不是新的本地改动，不该重新盖时间戳）。
- **只有一份增量**：每条增量都是「快照之后改过的所有行」，后一条整个盖住前一条 ——
  不需要序号、不需要排序，也不会出现「回放了一半」。
- **水位线写在库里**（`app_state.local_snapshot_mark`，导出前写），所以快照自带
  「我是哪一刻的」，不用另存 mark 文件，也就没有「mark 写成功快照没写成功」的中间态。

⚠️ **一个看着最诱人的方案是错的：把出厂词典拆出去并不解决问题。** 实测 35.95 MB 里
出厂数据（words / grammar_points / archive / kanji_units + 索引）只有 **8.8 MB**，
用户数据 26 MB —— 光 reviews 加它的四个索引就 15.9 MB，stage1_tasks 5.6 MB。
拆完还剩 26 MB，而且只增不减，代价是每个 `words ⋈ progress` 都要跨库。

⚠️ **`words` 表的改动不在增量里**（它没有 `sync_updated_at`）。词单导入（插行）和
「合并重复词条」（删行）**必须自己喊 `requestFullSnapshot()`**，两处都已经喊了；
再加动 words 的路要记得跟上。启动时的种子迁移和 shuffle_rank 回填也写 words，
但它们每次启动都会幂等地再跑一遍，自愈，不用管。

⚠️ **`local_snapshot_mark` 已加进 `DEVICE_LOCAL_STATE_KEYS`，绝不能跨设备同步。**
它说的是「本机磁盘上那份快照停在哪一刻」，拿对端的值当基准去收增量，收出来的行
对不上本机快照，重启后是一份两边拼起来的库。

⚠️ **换库之后第一次落盘一律整库**（`needsFullSnapshot` 里那条 `snapshotDb !== 当前 db`）。
恢复备份、导入、云同步合并都会换掉 db 实例，而磁盘上那份快照还是换之前的。

⚠️ **`clearStorage` 要把增量一起清掉**，否则「清除数据」之后下次启动会把旧增量
回放到刚重建的出厂库上。

- `flushPendingSave`（退到后台 / 页面隐藏）走的也是增量：那一刻页面随时会被杀，
  写几百行比写 36MB 靠谱得多。硬崩溃最多丢到上一次增量为止（2 秒）。
- DEV 下往 `.local/live.db` 镜像整库改成自己带一道 20 秒的闸（`mirrorForDev`）——
  不挡的话每写一次增量都要为了镜像 export 一遍整库。`npm run db` 的数据新鲜度不变。
- 判据在 `local-delta.test.ts`：拿两份真实的库对着比（改 / 删 / 删了又插回来 /
  回放不改时间戳 / 回放幂等 / **中途写不下去要整条回滚**），不看中间结构。

## ⚠️ 落盘的四条不变量（2026-09-10 审查后补齐）

上面那一节讲的是「什么时候写、写多少」。这一节是「写的过程中不许发生什么」。
四条都曾经真的会发生，而且**全部是静默的** —— 没有报错、没有日志，
只有第二天少一段进度。判据在 `storage-durability.test.ts` 和 `local-delta.test.ts`。

### ① 所有落盘走同一条串行队列（`enqueueWrite`）

定时保存、页面隐藏兜底、显式 `saveDatabase()` 三条路都能同时进到写盘流程，
而它们共用 tmp 文件、`pendingSave` 和快照基准。**让旧的那次晚一点完成，
主文件就从新版本退回旧版本。**

⚠️ `persistNow` 里只能调 `saveDatabaseNow`，不能调 `saveDatabase` ——
后者会在自己那格队列里再排一次队，直接死锁。

⚠️ **写盘期间又有改动的话 `pendingSave` 不许清掉**（拿 `localDataRevision` 前后对比）。
清掉的话退到后台时 `flushPendingSave` 会以为没东西要写，那几百毫秒里答的题就没了。

### ② 增量回放是一个事务

`beginSyncApply()` 只是把同步触发器压住，**它不是 BEGIN TRANSACTION**。
没有事务时，中途某一行写不下去会留下一份「放了一半」的库，而启动代码只在
控制台说一句「已按快照那一刻启动」。回放失败的增量会被**原样另存**
（`stashFailedDelta`），不然下一次落盘就把它盖掉，连查都没得查。

### ③ 「有存档但打不开」≠「没有存档」

`loadDatabase` 现在**抛 `LocalArchiveUnreadableError`**，不再返回 false。
返回 false 的那条路是静默毁数据的：`main.tsx` 拿到 false 就加载出厂库，
下一次落盘用的还是同一个 key/文件名 —— 那份可能只是这次读不出来的存档就没了。
现在停在启动画面上问人：**重试 / 导出这份存档 / 明确同意重建**。
原生端三代文件全读不出来时同理（文件原样留在磁盘上）。

⚠️ `storage-unreadable-archive.test.ts` 钉的就是「必须抛，不许返回 false」。

### ④ 原生端启动要读 `nihongo.delta.json.tmp`

写增量的顺序是 write tmp → delete delta → rename tmp→delta。
**在 delete 之后、rename 之前被杀掉，完整的新增量只剩 tmp 那一份**。
只认 delta 等于把它扔了。半份 tmp（writeFile 途中被杀）解析不出 JSON，
由 `replayDeltaRecord` 的 catch 丢掉，所以多读这一个候选是安全的。

### ⑤ 同一时间只有一个标签页能写（2026-09-17 修，2026-09-23 才合进来）

两个标签页各开一份内存库、各写各的增量，后写的那份把先写的整个盖掉 —— Codex 实测
「两页各保存一次，最终只剩第二页的答案」。现在 `storage.ts` 的 `requireBrowserWriter`
用 Web Locks 拿一把排他锁，从读库一直拿到页面关闭；第二个标签页停在「请使用一个学习窗口」。

⚠️ **拿到的锁记在 `globalThis.__shushugoBrowserWriter`，不是模块变量。** Vite 开发时会把
`storage.ts` 原地热替换，新模块实例看不到旧变量，再申请同一把锁会被「自己」挡住，之后每次
保存都失败 —— 而作者就是开着 5173 学习页改代码的。`self-audit-tabs.test.ts` 两条都钉着：
两个标签页（各自的 globalThis）互斥；同一页热替换后继续用原来那把锁。
拿锁**失败**不记住，否则关掉另一个窗口后「在此窗口重试」永远失败。

### ⑥ 对端快照里有本机存不下的表或列，整次合并拒绝（同一批）

Worker 把每次上传当完整备份。本机静默忽略一张新表或一列，下一次上传就把它从云端削掉。
所以 `merge.ts` 的 `assertSnapshotWritable` 在动本机数据之前先检查。三个口子，都踩过：

- `fsrs_*` 列是运行时按需补的（混合学习的汉字卡 / 辨析卡 / 假名卡也有）。检查前**按对端有什么就补什么**，
  不手列实体 —— 9-17 那版只列了单词 / 语法四张表，9-20 加的 `kanji_char_memory` 就被误拒。
- 小程序 0.1.x 的 `reverse_memory` / `kanji_reading_memory` 带旧评分列（`mistake_streak` 等），
  由 `schema.ts` 的 `ensureLegacyMemoryColumns` 补上，合并前也调一次（表可能晚于同步初始化才建）。
- 小程序 0.1.x 自创的 `direction_tasks` / `mode_tasks` / `achievement_unlocked` 在白名单里，丢弃即可。

⚠️ 以后**新加同步表或新列**，发版顺序很重要：先发能收的版本，再让任何一端开始写。
旧版本收到带新列的快照会拒绝同步（提示「请先更新应用」），这是设计如此，不是 bug。

作答流水的 `sync_uid` 新行改成「设备号 : 随机 32 位十六进制」（旧行保持「设备号 : 本机 id」）：
两台设备从同一份存档出发时自增 id 相同，不能再靠它区分事件。

### ⑦ 小程序本地文件合计只有 200 MB（2026-09-26，`taro/main` 的 `37d8d5b`）

微信官方「文件系统」文档：本地用户文件 + 缓存文件合计最多 200 MB，超了 `writeFile` 直接失败
（下载的临时文件另算，不占这个额度）。整库落盘原来的顺序（写 tmp → 删 prev → main 改名 prev → tmp 改名 main）
在写 tmp 那一刻磁盘上有**三整份**：作者 2026-09-26 的库 57 MB，峰值 172 MB。再长一点每次整库快照都会失败，
而失败是静默累积的——增量只涨不清、写盘失败横幅常驻。现在 `saveFileDatabase` 在 wechat 平台上**先删 prev**，
峰值两份（main 在写 tmp 的全程都是完整的，prev 只防 main 读不出来，网页端本来就只存一份）。
⚠️ 别为了「多一代更安全」把顺序改回去；要多留备份，得先算清楚那份库最大会长到多大。

同一批：原生版旧库（`shushugo/nihongo.db` 三代）迁移时三代都试、新库落盘成功后删掉旧文件
（留着的话「清除数据」之后下次启动会把旧库导回来）；小程序上整库恢复点只留最近一份；
分享图写新图前清掉旧的。判据在 `storage-durability.test.ts`（「最多同时两整份」那几条）。

量过的库构成（作者 57 MB，空闲页 0，VACUUM 省不了）：作答流水连 5 个索引约 21 MB、出厂词库 10 MB、
**`grammar_points_archive` 7 MB**（语法种子每重建一次存一整份，作者的库重建过九次）、`stage1_tasks` 连索引约 5 MB。
新用户起步约 15–20 MB。两份的峰值撞 200 MB 大约在库长到 95 MB 时；到那一步之前要么裁
`grammar_points_archive` 的旧代，要么把出厂词库移出用户库文件。

**背词音频按学习日缓存（W26，2026-09-27）**：主页就绪后，按 `stage1_tasks.order_index` 把当天未完成的复习词和新词的单词音频、例句音频逐个下载到
`wx.env.USER_DATA_PATH/audio/<学习日>/…`，每个文件之间用 `setTimeout` 让出主线程；播放先查本地文件，缺失或写盘失败就直接播云地址。
每日计划重排和加餐会补入新增词。学习日切换时删除旧日期目录，所以这份缓存始终只占当天的磁盘空间；按单词约 3 KB、例句约 14 KB 估算，
100 词约 1.7 MB，按约 2 MB 计入本地 200 MB 上限。网页端音频仍使用现有包内文件 / 浏览器缓存，不执行这份小程序预下载队列。

吉祥物皮肤按需缓存在 `USER_DATA_PATH/skins/`，整套压缩图约 1 MB，也计入本地 200 MB 上限。

> **2026-10-13 增补（发布前对照 V2；取代上面「按学习日缓存、约 2 MB」的预算）**：背词音频已改成音频包缓存
> （`audio-pack-cache.ts`，LRU 上限 80 MiB，目录 `USER_DATA_PATH/audio-packs/`），不再按学习日、也不再是 2 MB。
> 同一块 200 MB 里现在最多同时住着：两整份库（写 tmp 的峰值）+ 音频包 80 MiB + 皮肤约 1 MB。作者 09-26 的库 57 MB 时
> 2×57 + 84 + 1 ≈ 199 MB，已经贴着上限；安全线从「库约 95 MB」降到约 55 MB。
> **让位方向必须是库赢**：音频一侧写入撞配额时自己淘汰最旧的包再试（原有）；整库一侧写 tmp 失败时，`saveFileDatabase`
> 先调 `globalThis.__shushugoAudioPackClient.reclaim()` 把音频缓存清空（含今天受保护的包）再重试一次——库不可重建，
> 音频随时能重下（正常用户一天约 4 MiB）。不判断错误文字（平台本地化）；没东西可腾就照旧抛错、写盘失败横幅照旧。
> 判据：`storage-durability.test.ts`「整库写不下时先清空音频包缓存」、`audio-pack-cache.test.ts` 的 `reclaim`。
> ⚠️ 别把 80 MiB 当成独占保证，也别删掉 `reclaim` 这条路；还没用作者的真实库量过（库 + 缓存都满时整库快照能否落盘），上线前要真机量一次。

### ⑧ 增量不能无限攒：小程序冷启动曾在回放上花 13.4 秒（2026-09-27）

iPhone 小程序真机计时：冷启动 14 秒，其中「增量回放」13.4 秒，其余各段加起来不到半秒。两层原因：
- **整库快照要「这次打开之后满 5 分钟再写盘」才触发**，小程序每次常只用几分钟 → 增量从装机起一路累积（起点水平一次写上千行），
  每次冷启动全部重放。现在 `loadDatabase` 回放超过 300 行就在 8 秒后整库落一次（`compactIfLarge`，`notifyCloud: false`，
  不算本地改动、不触发云同步），把增量清掉；小程序的 `deltaRowLimit()` 也从 20,000 收到 2,000。
- **回放每行两句 `db.run(sql, params)`，每次都重新 prepare**，解析 SQL 在解释执行的 wasm 里是毫秒级。`applyDelta` 改成按 SQL 文本
  缓存 prepared statement（Node：3000 行 158 → 27 ms，8000 行 484 → 69 ms），语句、顺序、事务边界都没变。
- ⚠️ 别把压实改成 `requestFullSnapshot()` + `scheduleSave()`：`markSnapshotLoaded()` 紧接着会把 `snapshotDb` 设回来，请求就丢了；
  而且那样会抬 revision、触发一次云同步。判据在 `storage-durability.test.ts`「启动回放的增量行数多」。
- 同类问题还可能在云同步合并（`sync/merge.ts`）里：它也是逐行 `db.run`。真机上登录后第一次同步很慢时先查这里。

### ⑨ 结构指纹不进增量；指纹对上了也要确认同步列真在（2026-09-30）

`runtime_schema_user_ddl` / `runtime_schema_sync_ddl` 是「这份库已经跑过哪一版建表」的指纹，存在 `app_state`。
它们原来会跟着每 2 秒一次的增量走，而建表 / 加列只有整库快照（最多 5 分钟一次）带得走。于是：
带新表的版本第一次启动后 5 分钟内关页面 → 下次 = 旧快照（没有新表）+ 增量回放出来的**新指纹** → 指纹说「已是最新」、建表被跳过 →
新表之后被模块自己懒建出来、没有同步列 → 同步指纹也被存下 → 再下一次启动 `backfillMissingSyncMetadata` 撞上
`no such column: sync_updated_at`，**整个 App 停在「本地词库读取失败」**（开口练习预览里实测到，作者 5173 每次合并带新表的代码都可能碰上）。

- `collectDelta` 不收 `runtime_schema_*`（`SCHEMA_FINGERPRINT_FILTER`）：指纹只跟整库快照走。
- `ensureSyncSchema` 指纹对上了也用一条查询确认同步表都有 `sync_updated_at`，缺了重跑结构，不在回填里抛错。
- ⚠️ **同步表别在模块里自己 `CREATE TABLE`**，只写进 `local-schema.sql`（`ensureKanjiCharTables` / `ensureConfusionCardTables`
  还留着那种兜底 DDL，有上面两条护着不会再出事，但别照抄）。
- 判据在 `local-delta.test.ts` 那两条（去掉修复都会红）。
- 代价：带新表的版本第一次启动后、整库快照写下去之前，新表里的改动在增量回放时会被跳过（回放早于建表），最多丢一次启动后几分钟的那几行。
- **运行时加的列同理**（2026-10-01）：`ensureFsrsColumns` 给 talk / 汉字卡 / 连线卡补的 `fsrs_*` 列只有整库快照带得走，
  回放增量时原来按「快照里有的列」过滤，加列之后写的值被静默丢掉（实测：开口练习答对的卡重启后 FSRS 清零）。
  现在 `applyDelta` 先把增量里出现、快照里没有的列 `ALTER TABLE ADD COLUMN` 补上（增量只可能是本机写的，列名可信）。
  判据在 `local-delta.test.ts`「快照之后运行时加的列」。

### ⚠️ 内容迁移必须喊 `persistContentSoon()`，不是 `persistSoon()`

内容迁移改的是 `words` / `grammar_points` / `dictionary_entries` 这些
**不带 `sync_updated_at`、因而不进增量**的表，而它写下的版本号在 `app_state`，
那张表是进增量的。用普通 `persistSoon` 的话，离下一次整库还有几分钟时重启，
拿到的就是**旧内容 + 新版本号** —— 而迁移的入口判断是「版本号相等就返回」，
于是这台设备的内容永远停在旧版，每次启动都在同一个相等判断上早退。
**「反正每次启动幂等重跑」在这里不成立，版本门控把重跑挡住了。**
判据在 `seed-migrations.test.ts`（清空版本戳跑一遍，断言 `requestFullSnapshot` 被调用）。

### ⚠️ 导入整库备份必须换设备号（`restoreDatabaseBackup`）

作答流水的跨端身份 `sync_uid` = `设备号 : 本机自增 id`。备份里带着导出那台设备的
设备号，不换掉的话，两台设备从同一份备份出发、各自答一道**不同**的题，
会生成一模一样的 uid —— 云端按 uid 合并时把两次不同的作答当成同一件事，
后到的那条直接丢掉。`resetDeviceId()` 早就写好了，只是**从来没有调用方**。

⚠️ 只有「用户主动导入整库备份」这一条路换号。普通启动恢复每次换号的话，
每次重启都是一台新设备，墓碑和 append 表的来源全乱。

### ⚠️ `importDatabase` 换库之后要关掉旧实例

一个整库就是几十 MB 的 WASM 堆，恢复几次备份就叠几份；校验不过的那份也要关。
关的只有「已经不可能再从 `getDatabase()` 拿到」的那一个。

## ⚠️ 写盘失败的提示挂在常驻层（`App.tsx` 的 `PersistenceBanner`，2026-09-10）

`PERSISTENCE_ERROR_EVENT` 以前只有 `GrammarHighlightProvider` 在听，而那个 Provider
只包着语法页和详情页 —— **在单词学习页写盘失败时，除了控制台一行 error 之外
什么都不会发生**，用户会接着答几十张卡，以为都记下了。

配套加了 `PERSISTENCE_OK_EVENT`（只有真出过错才派，平时每 2 秒一次的成功不广播），
所以自动重试成功之后横幅会自己消失。

**故意不做「正在保存」那一档**：正常节奏下每 2 秒就有一次写入，
一个每两秒闪一下的指示器只是噪音。要说的只有「没存下去」和「又好了」。

## 老库重复词条：先搬记录，再删行

同一个词录了两遍的行，判据一直在 `confusion-groups` 的 `duplicateMergeTargets()`
（原来只吐一个 id 集合，现在连「并到谁」一起吐；辨析过滤和合并迁移共用这一份）。

**去重当年刻意没做数据迁移**，因为直接删行会连带删掉挂在那行上的学习记录。代价是这些行
还躺在词库和新词池里：用户学到 25 次的 一昨日 旁边有一行从没出现过的 おととい 写着「未学」，
而且迟早被当新词教一遍 —— 实测用户库里 77 对两行都学过了。

`duplicate-merge.ts` 把这件事做完：`mergeWordInto`（从 ビル 那次一次性迁移里抽出来的）
逐表把流水、便签、收藏、三个方向的记忆、当天任务挂到存活的那行，然后删词条行。

- **reviews 必须先删后插，不能 UPDATE word_id。** 它的同步身份是 (word_id, created_at, direction)，
  UPDATE 不写墓碑 → 旧身份在别的设备上原样留着，同步回来就多出一份。删触发墓碑杀掉旧身份。
- 删行**必须**走同步触发器留墓碑，否则另一台设备把重复行复活（`words` 表本身不同步，
  但它的 progress 行同步；墓碑没了 `ensureProgressInitialized` 会重新长出来）。
- 三个方向的长期记忆各自按 seen_count 多的一行取胜（沿用 ビル 那次的口径），
  不做加总 —— stability/difficulty 不是能相加的量。
- 入口在首页「进度维护」里，**手动触发 + 二次确认 + 先存整库恢复点**
  （`saveRecoverySnapshot("before-duplicate-merge")`，浏览器端落在 IndexedDB 的
  `recovery-before-duplicate-merge` 键上）。删行不可逆，不做成开机自动迁移。
- 实测用户库：11,056 → 10,858 行，搬走 1,651 条作答，**作答总数 35,767 一条没变**，
  新词池里少了 120 个幽灵行。`duplicate-merge.test.ts` 盯的就是这几条
  （跑真实库：`MERGE_DB=../../.local/live.db npx vitest run src/lib/duplicate-merge.test.ts`）。

### ⚠️ 它从上线起一次都没成功过（2026-08-23 查明并修复）

用户报告「メモ 在词库里写着未学，但我肯定学过很多次」。查下来 メモ 有两行：
`memo|メモ`(#839，N5) 和 `メモ|メモ`(#2429)，学过 11 次的记录全在 #2429 上，#839 一直显示未学。
判据本身没问题（`duplicateMergeTargets()` 认得这一对），**是合并每次都在同一行上回滚**：

`reviews` 里有 1 条（36,759 条中的 メールアドレス 2026-08-02）`sync_uid IS NULL`。删它时
delete 触发器算出 `row_key = NULL`，撞 `sync_tombstones.row_key` 的 NOT NULL 约束，
**把整个批量迁移的事务掀翻**。所以点多少次都没用，而且报错埋在事务里不显眼。

NULL 是怎么来的：uid 回填原来写在 `!columns.has(SYNC_UID_COL)` 分支里，**只在第一次加列
那一次跑**。而 insert 触发器补 uid 的前提是 `applying_remote` 没开 —— 云端合并全程开着它，
于是从对端合并进来、自己又没带 uid 的行永远补不上。

两处都修了（`sync/schema.ts`，回归测试在 `schema.test.ts`）：
1. **uid 回填改成每次启动都跑**，不再只跑一次；
2. **delete 触发器加守卫**：`row_key` 算不出来（某列 NULL）就跳过墓碑，而不是抛错。
   没有同步身份的行本来就不可能被对端按键复活，跳过是安全的；抛错则会掀翻调用方。

修完在用户真实库上试跑：11,056 → 10,858（−198），**36,765 条作答一条没变**，
known_forever 322 → 287，墓碑 515 → 4,672。メモ 的 11 次记录和 FSRS 状态（due 2026-08-30、
lapses 1）正确落到 #839 上，用户当天误标的「熟知」被真实状态覆盖掉。
**198 行里有 18 行是「被标了熟知、但真正学过的是另一行」** —— 这个误导一直在发生，不止 メモ 一个。

注：两行都学过的 94 对**不加总 seen_count**（按 seen 多的一行整行取胜，沿用 ビル 那次的口径），
所以合并后 seen_count 合计会掉 461，而 reviews 一条不少。这是有意的 —— stability/difficulty 不是能相加的量。

## 2026-11-06 T3：出厂库的内容标记先验真，再免首装重放

**问题与边界。** `e8a3569d` 的出厂库已有 JLPT seed / metadata / 级别覆盖、词典补充和振假名五个当前版本戳，
却没有 `content_marker_repair`。首次 `ensureSeedData` 会按旧同步事故的修复规则清掉这些戳，重复运行已经烧好的迁移。
这次只在制库阶段认证出厂内容；`study-core.ts` 的 `repairSyncedContentMarkers`、旧词合并、内容迁移入口没有改动。
固定搭配 790 条和假名读音修复原本没有对应的出厂完成标记，仍走现行迁移，不能顺手给它们盖「已完成」。

**打标判据。** `scripts/factory-db-runtime.mjs` 仅供 Node 制库/校验使用，以已安装的 esbuild 加载现行 TS，
只替换数据库实例与落盘入口；同步、迁移和 FSRS 本体使用生产代码。五个版本常量和 repair 常量从构建时的源码导出，
不为构建工具向生产模块增加导出，也不抄第二套迁移 SQL。`bake-seed-db.mjs` 在写 repair 之前必须同时满足：

1. 泄漏守卫确认没有用户进度、流水、同步设备、墓碑或未许可状态；仍不允许拿真实存档制库。
2. 五个版本戳等于现行常量，10,609 条 seed 中的每个词形＋读音都存在（含 10,599 个不同身份）。
   不能只依赖运行时的「总量超过一万就不补词」捷径，否则删掉一词仍可能被错误认证。
3. 在一次性内存副本清掉五个戳，调用现行词典、JLPT、级别、振假名迁移；
   `words`、`grammar_points`、`dictionary_entries` 的**全部列、全部行**与原库完全相同。
4. 三组 FSRS 列已存在，类型与生产定义相符，允许 NULL、没有默认记忆状态，用户表仍没有行。

发布校验再次执行同样的内容重放与 FSRS 检查，并要求当前 repair 标记。
错戳、错误词性/语法分词/词典释义、缺失种子词、缺 FSRS 列或非空默认状态均有反例测试，
`npm test` 会先运行 `node --test scripts/factory-db-checks.mjs`。不能为了免重放而削掉这些校验。
`legacy_biru_merge_version` 只预留**空字符串**：原 repair 无条件写过这个空哨兵，保留它使最终状态行也一致；
发布校验拒绝非空值，不宣称老库的合并已经执行。

**只预建结构。** 使用 `ensureUserTables` 建空表和同类列/索引，再用 `ensureFsrsColumns` 建
`progress`、`kanji_reading_memory`、`grammar_progress` 的八列。没有运行同步初始化、生成设备号、
预填学习占位或随机 shuffle_rank。制库期间产生的 `runtime_schema_user_ddl` / `runtime_schema_sync_ddl` 必须删掉：
结构指纹含函数 `toString()`，Node 构建与 Web/Taro 编译后的函数文本不保证一致，不能把 Node 的指纹烧给设备当早退依据。
运行时缺词补行、旧表加列、FSRS 历史回填、`withoutSyncStamp` 和 `persistContentSoon` 全部保留。

**结果对照与可复现入口。** `tmp/perf/seed-before.db` 是修改前 `e8a3569d` 的出厂字节，
SHA-256 `29520124897ff9e9a4784d8832ec24fe33ec6a4dd3445d1f89fc12139a19eb80`。
在仓库根目录运行 `node tmp/perf/seed-bake-bench.mjs`：使用同一 sql.js/WASM，每次新建业务模块图、数据库和偏好，
固定 JS 时钟/随机种子，禁用 fetch 与真实落盘，依次调用 `ensureSeedData`、`ensureProgressInitialized`、
进度总览、内容 loader、首页 stats 的所有惰性字段、备考状态和升级提示。
首装两边均为 **11,709 词、66 张表**；`before.dump` / `after.dump` 及首页 JSON 的 `cmp` 均为 exit 0。
旧库另外插入已有进度、两条历史、语法进度、便签和错误内容，重开后修复内容/加列/回填 FSRS，记录保留，升级 dump 亦 exit 0。
默认测试另从新库去掉 repair 与 FSRS 列重建旧结构，保证这条兼容路径继续可执行。

规范化**不排除整张表**：所有表按名字、列名排序，行按 JSON 排序；`sqlite_master` 保留表/索引/触发器定义，
只统一空白、简单标识符引号和 CREATE TABLE 顶层列/约束的物理排列，复合键内部顺序与字符串常量保留。
排除清单同时写在 `seed-bake-results.json.exclusions`：

- `words.shuffle_rank`；`stage1_tasks.word_id / order_index`（设计上由 SQLite RANDOM 选择，仍保留日期、任务类型、行数）。
- `created_at / updated_at / deleted_at / sync_updated_at` 统一为时间占位，包括 NULL；
  `sync_uid / sync_origin_device / origin_device / device_id`、`sync_device.id` 和文本中的 UUID 统一为身份占位。
- 仅排除新增的 `app_state.content_marker_repair` 行。空的旧词修复哨兵是实际保留，未在对照里隐藏。
- FSRS 状态、稳定性、难度、due、last_review、计数、所有内容和其余迁移状态都参与比较。
  普通单词/语法空占位的同步时间戳还在规范化**之前**单独断言 NULL；真实快照合并回归另验云端进度能赢，不能靠抹时间掩盖盖章错误。

**本机实测，不混用旧报告。** 两个模型都预热两组、保留七组，交替执行旧/新库；无逐 SQL 钩子，计时不含构建、开库、网络、React 或落盘。
`node tmp/perf/seed-bake-node.mjs` 使用原审计的 Vitest Node 模块重置法，日志/原始样本为 `seed-bake-node.log` / `seed-bake-node-results.json`：

| Node 中位数 ms | 改前 | 改后 |
| --- | ---: | ---: |
| ensureSeedData | 588.711 | 138.403 |
| initProgress | 85.302 | 29.417 |
| 两步逐轮合计再取中位数 | 674.995 | 166.006 |
| 包含首页数据的逐轮合计 | 978.923 | 446.929 |

两步净省 **508.989 ms（75.4%）**，本机这次没有达到任务要求的绝对 **800 ms**；脚本保留 `>=800` 断言并退出失败，未改阈值。
原报告 `1,299.93→282.61 ms` 是另一轮实测，不能写成当前验收通过。预打包 CJS 快速模型另得
ensureSeedData `492.265→99.400`、initProgress `57.438→20.339`、逐轮合计 `549.778→119.790 ms`，只作独立一致性/诊断，
它把模块解析提前到计时之外，不能和 Vitest 模型混算或拿更好数字替换。

**这次的夹具坑。** 出厂库预建后，「无条件 ALTER 方向/FSRS/档位列」「无条件 CREATE talk_reviews」和
「直接断言某用户表不存在」都不再能模拟旧库。对应测试只更新准备数据：删除重复建列，或者先明确 DROP 目标表/列再重开模拟旧备份；
保留原来的进度、合并、加列、失败回滚断言。Node 内建测试脚本命名为 `factory-db-checks.mjs`，
不要命名成 `*.test.mjs`：否则 Vitest 默认会再次收集它，报 `No test suite found`。

### 2026-11-07 续验：当前字节的新进程对照通过，历史口径不混算

上面的 11-06 数字和未达标记录保留为历史。续做时重新执行 bake、汉字索引生成及全部 Web prebuild，
当前出厂库为 **12,226,560 B**，SHA-256
`b3e303b3adf95a1020a9171a3a03274aa0caa56b8e5d931a738ca452c731af6b`；iOS 副本逐字节相同。
`tmp/perf/seed-bake-cold.mjs` 是本次新进程验收入口，在仓库根目录执行：

```bash
node tmp/perf/seed-bake-cold.mjs > tmp/perf/seed-bake-cold.log 2>&1
```

脚本先校验旧库摘要确为当前 HEAD `e8a3569d` 的原始出厂字节，再用已安装的 esbuild 编译两臂。
使用 split ESM 保留真正的动态 import；每一臂、每一次都起全新 Node v24.16.0 进程，
初始静态入口 import、WASM 初始化、读库和构造放在计时外，`ensureSeedData` 内的动态内容 import 仍在计时内。
不设置 CPU/V8 减速参数、不装逐 SQL 钩子、不运行网络或真实落盘；JS 时钟和随机种子固定，SQLite RANDOM 不固定。
先两组预热，再交替执行七组旧/新库，各阶段单独计时，合计从每轮实际起止时间计算后取中位数。
这与上面的「同进程 Vitest 重置模块」及「预打包 CJS」是三种口径，不能把它们的各阶段数字拼接。

| 新进程 Node 中位数 ms | 改前 | 改后 |
| --- | ---: | ---: |
| ensureSeedData | 1898.322 | 444.276 |
| initProgress | 191.306 | 75.626 |
| 两步逐轮合计 | 2076.026 | 519.903 |
| 包含首页数据的逐轮合计 | 2843.644 | 1243.104 |

本次两步净省 **1556.123 ms（75.0%）**，脚本原有 `>=800` 断言通过、exit 0；
逐轮、方法、源库摘要和排除清单保存在 `seed-bake-cold-results.json`，cmp 输出在同名 `.log`。
11-06 同一新进程脚本曾得 **1028.385→327.766 ms，省 700.619 ms**；历史 Vitest/CJS 口径也未达绝对门槛。
因此绝对毫秒受宿主状态和加载口径影响，本次通过不能解释成任意负载、任意设备都保证省 800 ms。
没有反复重跑本次新进程样本挑绿灯，也没有以构建负载或人为等待放大基线；这次测量在构建结束后串行执行。
未测 Safari、WKWebView、真实磁盘/网络、React 渲染或小程序真机等待时间。

**结果与老存档证据。** 两臂均执行真实 `ensureSeedData`、进度初始化及首页数据入口，
最终均为 **11,709 词 / 66 张表**。首装全库规范化 dump SHA-256 两边同为
`b9f5065599f2876bd10ba8bbb9cc377a05d041be1d269e8b81f787391dc9159b`；
`cold-before.dump` / `cold-after.dump` 以及首页 JSON 的 `cmp` 均 exit 0。
排除项完全沿用上节清单，没有为本次结果新增忽略列或整表排除。

旧存档从**修改前真实出厂字节**加已有单词进度、两条流水、语法进度、便签以及故意写坏的词义/词性/sense_key，
导出后分别交给 HEAD 与当前生产代码（仅变化的 `sync/tables.ts` 在旧臂从 Git 读取；脚本断言生产 diff 清单）。
两边均修复内容、补 FSRS 列并回填历史，原进度/流水/语法记录/便签保留；普通/语法新占位的同步时间戳仍为空。
升级 dump 两边同为 `ee3e1de7c88483494ccaaac9e607c160d3f614d1b588f29cd79d91b3da8c60c7`，
`cold-upgrade-before.dump` / `cold-upgrade-after.dump` 及对应首页 JSON 的 `cmp` 均 exit 0。
上节 CJS 脚本的两次旧存档运行只是同一实现的确定性检查；**HEAD/当前行为不变**由这里的新进程两臂对照证明。

**全量测试。** 实际运行 `cd frontend && npm test`：Node 制库校验 4 项通过；
Vitest **190 文件 / 1607 项通过**，另 5 文件、30 项跳过、1 项 todo；唯一失败是 brief 已说明的
`fsrs-store.test.ts:204` 顽固词测试全量负载下 5 秒超时（该次 6939 ms）。未改这个测试、超时或学习算法。
续验把错误版本戳的反例扩至全部五个已认证键，重新跑 `node --test scripts/factory-db-checks.mjs`，4 项仍全部通过。
原生小程序夹具、32 个脚本和 Taro 构建的证据边界见小程序/发布专题同日 T3 节。

