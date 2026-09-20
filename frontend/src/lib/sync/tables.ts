// 增量同步的表清单与合并口径。
//
// 整库覆盖式备份在双端使用时会互相吃掉进度(后上传的整库把先学的那端抹掉),
// 所以这里改成按行同步:每张表标出主键列和合并策略,同步时只传变更行。

export type MergeStrategy =
  /** 按 sync_updated_at 取较新的一行(逐行 last-write-wins)。 */
  | "lww"
  /** 只增不改的事件日志,两端取并集;靠 sync_uid 去重。 */
  | "append"
  /** 天然幂等的集合(如打卡日期),两端取并集。 */
  | "union";

export interface SyncedTable {
  table: string;
  /** 组成一行身份的列;绝不能使用业务表的自增 id。 */
  keys: string[];
  strategy: MergeStrategy;
}

// 只列用户数据表。words / grammar_points 这类出厂内容两端一致,不参与同步。
export const STUDY_TIME_TABLE = "word_study_time_by_device";

export const SYNCED_TABLES: SyncedTable[] = [
  // 每词/每语法点的记忆状态,FSRS 的列也在 progress 上,是同步的核心。
  { table: "progress", keys: ["word_id"], strategy: "lww" },
  // 新汉字读音题不继承旧 kanji_memory；旧表继续同步，作为历史归档保留。
  { table: "kanji_reading_memory", keys: ["word_id"], strategy: "lww" },
  { table: "kanji_memory", keys: ["word_id"], strategy: "lww" },
  { table: "kanji_unit_memory", keys: ["unit_key"], strategy: "lww" },
  { table: "kanji_unit_flags", keys: ["unit_key"], strategy: "lww" },
  { table: "kanji_unit_tasks", keys: ["reviewed_on", "unit_key"], strategy: "lww" },
  // 单独汉字卡（kanji-char-cards.ts）。memory 是检查点，合并后由 kanji_char_reviews 重放重建。
  { table: "kanji_char_memory", keys: ["char"], strategy: "lww" },
  { table: "kanji_char_tasks", keys: ["reviewed_on", "char"], strategy: "lww" },
  // 反向卡的长期记忆。和 kanji_memory 同构:每个词一行,逐行 LWW。
  { table: "reverse_memory", keys: ["word_id"], strategy: "lww" },
  { table: "grammar_progress", keys: ["grammar_id"], strategy: "lww" },
  { table: "grammar_mistakes", keys: ["grammar_id"], strategy: "lww" },
  { table: "word_notes", keys: ["word_id"], strategy: "lww" },
  { table: "word_question_meanings", keys: ["word_id"], strategy: "lww" },
  // 用户自己导入的词条内容。出厂词典不同步,但自定义词必须跟着走 ——
  // 否则新设备收到的是一堆指向不存在词条的学习记录(见 custom_words 的建表注释)。
  // union:导入之后内容不再改,也不该被对端那份「更新」覆盖掉本机的编辑。
  { table: "custom_words", keys: ["word_id"], strategy: "union" },
  // 例句词典主动发现的词，跨端合并后仍应优先进入新词计划。
  { table: "dictionary_discovered_words", keys: ["word_id"], strategy: "union" },
  // 疑难辨析里标过「已掌握」的词组。主键是词组标识而不是 word_id。
  { table: "confusion_mastered", keys: ["group_key"], strategy: "lww" },
  // 成就。取并集而不是 LWW：解锁是不可逆的,两端各拿到的都该留下,
  // 也不该因为对端那行「更新」就把本机的解锁日期改掉。
  { table: "achievements", keys: ["id"], strategy: "union" },
  { table: "moji_migrated_reviews", keys: ["word_id"], strategy: "lww" },

  // 当天的学习会话状态,换设备继续学时要能接上。
  { table: "critical_reviews", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage1_tasks", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage2_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "kanji_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "kanji_reading_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },

  // 键值状态。含设备本地键(见 DEVICE_LOCAL_STATE_KEYS),推送前会过滤。
  { table: "app_state", keys: ["key"], strategy: "lww" },
  { table: "grammar_state", keys: ["key"], strategy: "lww" },

  // 语法阅读状态不是内容数据，必须跟随用户库跨设备同步。
  { table: "grammar_highlights", keys: ["grammar_id", "block", "start", "end"], strategy: "lww" },
  { table: "grammar_reading_positions", keys: ["kind", "level"], strategy: "lww" },

  { table: "content_favorites", keys: ["item_type", "item_id"], strategy: "lww" },
  // 收藏夹名字就是行身份(不是自增 id),所以两端各建一个同名夹子天然是同一个。
  { table: "favorite_folders", keys: ["name"], strategy: "union" },
  // 查词汇量的历史成绩。每次测完追加一行、之后不再改，取并集即可。
  { table: "vocab_test_history", keys: ["run_id"], strategy: "union" },
  // 柚子账本。每一行是一笔不可变的账,身份是 (kind, key),两端取并集。
  { table: "yuzu_ledger", keys: ["kind", "key"], strategy: "union" },

  // 复习流水按触发器分配的设备:本机 id 去重。created_at 只有秒级精度，
  // 同一秒的两次作答会撞自然键；sync_uid 才是稳定事件身份。
  { table: "reviews", keys: ["sync_uid"], strategy: "append" },
  { table: "grammar_reviews", keys: ["sync_uid"], strategy: "append" },
  { table: "grammar_activity_events", keys: ["sync_uid"], strategy: "append" },
  { table: "kanji_unit_reviews", keys: ["sync_uid"], strategy: "append" },
  { table: "kanji_char_reviews", keys: ["sync_uid"], strategy: "append" },

  { table: "checkins", keys: ["checked_on"], strategy: "union" },
  // 播报过的时刻。天然幂等的集合,和打卡同构:两端取并集,
  // 换台设备不会把同一句「比昨天少 48 个」再说一遍。
  { table: "moments", keys: ["kind", "key"], strategy: "union" },
  // 每台设备每天只写自己的一行，因此同一主键可安全使用 LWW；跨设备统计时求和。
  { table: STUDY_TIME_TABLE, keys: ["studied_on", "device_id"], strategy: "lww" },
  // 周报计时按 14:00 周期归档；每台设备一行，读取时求和。
  { table: "study_time_by_period", keys: ["period_start", "device_id"], strategy: "lww" },
  { table: "weekly_reports", keys: ["week_start"], strategy: "lww" }
];

/** 通用云同步的表清单。免费账号保留本机周报，但不把快照正文上传到云端。 */
export const syncedTablesForCloud = (includeWeeklyReports: boolean): SyncedTable[] => (
  includeWeeklyReports
    ? SYNCED_TABLES
    : SYNCED_TABLES.filter((entry) => entry.table !== "weekly_reports")
);

/**
 * 「本机这份出厂词典/语法内容迁移到哪一版了」的标记。
 *
 * ⚠️ 这些描述的是**本地内容**,而 words / grammar_points 本身根本不进快照。
 * 同步它们等于把对端的「已完成」写到一台还没跑过迁移的设备上,而迁移的入口
 * 判断是「版本号相等就直接返回」——结果是版本标记新、词典还是旧的,
 * 而且这个偏差不会自己好:每次启动都在同一个相等判断上早退。
 *
 * 语法那条更贵:`ensureGrammarSeed` 是按 pattern 把用户进度迁到新 id 的,
 * 被跳过一次就意味着这台设备的 grammar_id 和别人错位(见 CLAUDE.md)。
 *
 * ⚠️ **不能粗暴过滤所有带 version 的键**:`stage1_plan_version` 说的是
 * 「今天的计划按哪一版算法排的」,那是用户调度状态,该同步。
 */
export const CONTENT_MIGRATION_STATE_KEYS = [
  "jlpt_seed_version",
  "jlpt_word_metadata_version",
  "jlpt_level_override_version",
  "jlpt_collocation_content_version",
  "dictionary_supplement_version",
  "furigana_version",
  "kana_reading_fix_version",
  // 老库重复词条的合并:它删的是 words 行(不同步),所以每台设备得自己跑一遍。
  "legacy_biru_merge_version"
] as const;

// app_state 里描述「这台设备」而非「这个账号」的键,同步会跳过,
// 否则设备标识本身会被对端覆盖,同步就乱套了。
export const DEVICE_LOCAL_STATE_KEYS = new Set([
  "sync_device_id",
  "sync_cursor",
  "sync_last_pushed_at",
  // 本机快照的水位线(见 local-delta.ts)。**绝不能跨设备同步**:
  // 它是「本机磁盘上那份快照停在哪一刻」,拿对端的值当基准去收集增量,
  // 收出来的行会对不上本机的快照,重启后就是一份两边拼起来的库。
  "local_snapshot_mark",
  // 周报的本地观测台账（见 analytics/weekly-report-events.ts）。它是「这台设备
  // 上发生过什么」的诊断记录，不是账号数据：同步过去只会让对端的计数被顶掉，
  // 而且计划明确要求这类采集先只留本地、不默认上传。
  "weekly_report_events",
  ...CONTENT_MIGRATION_STATE_KEYS
]);


/** grammar_state 里的本地内容标记。语法种子版本同理,而且错位代价更大。 */
export const DEVICE_LOCAL_GRAMMAR_STATE_KEYS = new Set(["dataset_version"]);

/** 某张键值表里的这个键是否「只属于这台设备」。导出和导入两边共用这一份。 */
export const isDeviceLocalStateKey = (table: string, key: string): boolean => (
  table === "app_state" ? DEVICE_LOCAL_STATE_KEYS.has(key)
    : table === "grammar_state" ? DEVICE_LOCAL_GRAMMAR_STATE_KEYS.has(key)
      : false
);

/**
 * word_study_time 不在上表里:它按 studied_on 单主键记录每天学习秒数,
 * 两端同一天各学一段时,LWW 会丢掉一端、求和又会在重复同步时越加越多。
 * 改为同步 word_study_time_by_device(studied_on, device_id),
 * 各设备只写自己那行,统计时按天求和。见 sync/study-time.ts。
 */
export const isAppendTable = (table: string): boolean =>
  SYNCED_TABLES.find((entry) => entry.table === table)?.strategy === "append";
