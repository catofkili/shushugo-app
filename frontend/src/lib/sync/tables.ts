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
  /** 组成一行身份的列;append 表用 sync_uid 代替。 */
  keys: string[];
  strategy: MergeStrategy;
}

// 只列用户数据表。words / grammar_points 这类出厂内容两端一致,不参与同步。
export const SYNCED_TABLES: SyncedTable[] = [
  // 每词/每语法点的记忆状态,FSRS 的列也在 progress 上,是同步的核心。
  { table: "progress", keys: ["word_id"], strategy: "lww" },
  { table: "kanji_memory", keys: ["word_id"], strategy: "lww" },
  { table: "grammar_progress", keys: ["grammar_id"], strategy: "lww" },
  { table: "grammar_mistakes", keys: ["grammar_id"], strategy: "lww" },
  { table: "word_notes", keys: ["word_id"], strategy: "lww" },
  { table: "moji_migrated_reviews", keys: ["word_id"], strategy: "lww" },

  // 当天的学习会话状态,换设备继续学时要能接上。
  { table: "critical_reviews", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage1_tasks", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "stage2_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },
  { table: "kanji_progress", keys: ["reviewed_on", "word_id"], strategy: "lww" },

  // 键值状态。含设备本地键(见 DEVICE_LOCAL_STATE_KEYS),推送前会过滤。
  { table: "app_state", keys: ["key"], strategy: "lww" },
  { table: "grammar_state", keys: ["key"], strategy: "lww" },

  { table: "content_favorites", keys: ["item_type", "item_id"], strategy: "lww" },

  // 复习流水:两端各自追加,合并取并集。
  { table: "reviews", keys: ["sync_uid"], strategy: "append" },
  { table: "grammar_reviews", keys: ["sync_uid"], strategy: "append" },

  { table: "checkins", keys: ["checked_on"], strategy: "union" }
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
export const STUDY_TIME_TABLE = "word_study_time_by_device";

export const isAppendTable = (table: string): boolean =>
  SYNCED_TABLES.find((entry) => entry.table === table)?.strategy === "append";
