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

