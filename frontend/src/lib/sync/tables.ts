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
  { table: "kanji_memory", keys: ["word_id"], strategy: "lww" },
  // 反向卡的长期记忆。和 kanji_memory 同构:每个词一行,逐行 LWW。
  { table: "reverse_memory", keys: ["word_id"], strategy: "lww" },
  { table: "grammar_progress", keys: ["grammar_id"], strategy: "lww" },
  { table: "grammar_mistakes", keys: ["grammar_id"], strategy: "lww" },
  { table: "word_notes", keys: ["word_id"], strategy: "lww" },
  // 例句词典主动发现的词，跨端合并后仍应优先进入新词计划。
  { table: "dictionary_discovered_words", keys: ["word_id"], strategy: "union" },
  // 疑难辨析里标过「已掌握」的词组。主键是词组标识而不是 word_id。
  { table: "confusion_mastered", keys: ["group_key"], strategy: "lww" },
  { table: "moji_migrated_reviews", keys: ["word_id"], strategy: "lww" },

  // 当天的学习会话状态,换设备继续学时要能接上。
  { table: "critical_reviews", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage1_tasks", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage2_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "kanji_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },

  // 键值状态。含设备本地键(见 DEVICE_LOCAL_STATE_KEYS),推送前会过滤。
  { table: "app_state", keys: ["key"], strategy: "lww" },
  { table: "grammar_state", keys: ["key"], strategy: "lww" },

  // 语法阅读状态不是内容数据，必须跟随用户库跨设备同步。
  { table: "grammar_highlights", keys: ["grammar_id", "block", "start", "end"], strategy: "lww" },
  { table: "grammar_reading_positions", keys: ["kind", "level"], strategy: "lww" },

  { table: "content_favorites", keys: ["item_type", "item_id"], strategy: "lww" },

  // 复习流水:用业务事件的自然键去重,两端各自追加并取并集。
  // reviews.id / grammar_reviews.id 都是本机自增值,绝不能作为跨设备身份。
  { table: "reviews", keys: ["word_id", "created_at", "direction"], strategy: "append" },
  { table: "grammar_reviews", keys: ["grammar_id", "created_at"], strategy: "append" },

  { table: "checkins", keys: ["checked_on"], strategy: "union" },
  // 播报过的时刻。天然幂等的集合,和打卡同构:两端取并集,
  // 换台设备不会把同一句「比昨天少 48 个」再说一遍。
  { table: "moments", keys: ["kind", "key"], strategy: "union" },
  // 每台设备每天只写自己的一行，因此同一主键可安全使用 LWW；跨设备统计时求和。
  { table: STUDY_TIME_TABLE, keys: ["studied_on", "device_id"], strategy: "lww" }
];

// app_state 里描述「这台设备」而非「这个账号」的键,同步会跳过,
// 否则设备标识本身会被对端覆盖,同步就乱套了。
export const DEVICE_LOCAL_STATE_KEYS = new Set([
  "sync_device_id",
  "sync_cursor",
  "sync_last_pushed_at"
]);

/**
 * word_study_time 不在上表里:它按 studied_on 单主键记录每天学习秒数,
 * 两端同一天各学一段时,LWW 会丢掉一端、求和又会在重复同步时越加越多。
 * 改为同步 word_study_time_by_device(studied_on, device_id),
 * 各设备只写自己那行,统计时按天求和。见 sync/study-time.ts。
 */
export const isAppendTable = (table: string): boolean =>
  SYNCED_TABLES.find((entry) => entry.table === table)?.strategy === "append";
