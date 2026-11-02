import { collocationTier } from "./collocation-tier";
import { getDatabase } from "./database";
import { firstValue, getState, persistContentSoon, rowsFor, setState } from "./database/db-utils";
import { JLPT_COLLOCATION_CONTENT_VERSION } from "./study-core";

type JlptCollocationContentEntry = {
  surface: string;
  kana: string;
  level: "N1" | "N2" | "N3" | "N4" | "N5";
  kind: string;
  meaning: string;
  jmdict_ent_seq: number;
  // Compact content-only tier: absent = common, 0 = core, 2 = optional; written to words.collocation_tier by the content migration.
  t?: 0 | 2;
};

type JlptCollocationContent = {
  schema_version: number;
  status: string;
  reviewed_at: string;
  entries: JlptCollocationContentEntry[];
  removed: { surface: string; kana: string }[];
};


const loadJlptCollocationContent = async (): Promise<JlptCollocationContent> => {
  const payload = await import("../data/jlpt_collocation_content.json");
  // 原生小程序的 shim 返回可重试异步 loader；网页/Taro 的正文直接在懒加载块内。
  const source = payload.default as JlptCollocationContent | (() => Promise<JlptCollocationContent>);
  return typeof source === "function" ? source() : source;
};

// 固定搭配是 JLPT 主词库之后的第二层种子。它独立于 10k JLPT seed 版本，
// 这样已有用户不会因为基础词库版本已满足而永远收不到新增表达；只按表记＋读音
// 插入缺失行，不覆盖用户可能自行导入或改写的同形词条。
export const migrateJlptCollocationContent = async () => {
  if (getState("jlpt_collocation_content_version", "") === JLPT_COLLOCATION_CONTENT_VERSION) return;

  const content = await loadJlptCollocationContent();
  if (content.status !== "content_ready_runtime_migration" || content.entries.length !== 790) {
    throw new Error(`固定搭配内容版本无效: status=${content.status} entries=${content.entries.length}`);
  }
  if (content.entries.some((entry) => !entry.surface || !entry.kana || !entry.meaning || !/^N[1-5]$/.test(entry.level))) {
    throw new Error("固定搭配内容存在缺少表记、读音、释义或等级的条目");
  }

  const db = getDatabase();
  const existing = new Set(
    rowsFor("SELECT kanji, kana FROM words")
      .map((row) => `${String(row.kanji ?? "")}\u0000${String(row.kana ?? "")}`)
  );
  const insertedIds: number[] = [];
  db.run("BEGIN TRANSACTION");
  try {
    content.entries.forEach((entry) => {
      const key = `${entry.surface}\u0000${entry.kana}`;
      if (!existing.has(key)) {
        db.run(`
          INSERT INTO words (
            meaning, kana, kanji, pos, verb_type, importance,
            shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
          )
          VALUES (?, ?, ?, ?, NULL, ?, ABS(RANDOM()) / 9223372036854775807.0, '', '', '', '', '', ?)
        `, [entry.meaning, entry.kana, entry.surface, "固定搭配", 3, entry.level]);
        const newId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
        if (newId > 0) insertedIds.push(newId);
        existing.add(key);
      }
      db.run("UPDATE words SET collocation_tier = ? WHERE pos = '固定搭配' AND kanji = ? AND kana = ?",
        [{ core: 0, common: 1, optional: 2 }[collocationTier(entry)], entry.surface, entry.kana]);
    });
    insertedIds.forEach((wordId) => db.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [wordId]));
    retireRemovedCollocations(content.removed);
    setState("jlpt_collocation_content_version", JLPT_COLLOCATION_CONTENT_VERSION);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistContentSoon();
};

// v2（2026-10-10）删掉了 92 条「拼起来就懂」的搭配（写真を撮る、時間がかかる……）。
// 老库里的这些行分两种处理：
// - 从没碰过的（progress 没见过，且除 progress 外没有任何表用 word_id 指着它）→ 删行。
//   带 word_id 的表现查 sqlite_master，不手抄名单 —— 以后加表不用记得回来登记。
//   progress 走同步触发器留墓碑，别的设备不会把它同步回来。
// - 碰过的（作答、新词任务、便签、收藏……）→ 不删，标「熟知」退出排期。删行不可逆，
//   开机自动迁移不许连带删学习记录（见 docs/claude/storage-and-persistence.md 老库重复词条）。
//   作者实测库里 N5/N4 那 33 条都已作为新词推过（stage1_tasks + seen_count=1），
//   作者嫌「太显然」的正是它们，所以「留着照常排期」不算解决。
const retireRemovedCollocations = (removed: { surface: string; kana: string }[]) => {
  if (!removed.length) return;
  const db = getDatabase();
  const columnsOf = (table: string) => rowsFor(`PRAGMA table_info("${table}")`).map((column) => String(column.name));
  const wordTables = rowsFor("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'words'")
    .map((row) => String(row.name))
    .filter((table) => columnsOf(table).includes("word_id"));
  const referencing = wordTables.filter((table) => table !== "progress");
  // 反向、汉字、拼写各有一张记忆表，只标 progress 的话换个方向还会被排出来。
  const knowable = wordTables.filter((table) => columnsOf(table).includes("known_forever"));
  const touched = (id: number) =>
    // 「标记熟知」不经作答也会写 progress，所以不能只看 seen_count。
    firstValue<number>(`
      SELECT COUNT(*) FROM progress WHERE word_id = ? AND (
        COALESCE(seen_count, 0) > 0 OR COALESCE(known_forever, 0) <> 0
        OR last_seen_on IS NOT NULL OR mastered_on IS NOT NULL
      )
    `, [id], 0) > 0
    || referencing.some((table) => firstValue<number>(`SELECT COUNT(*) FROM "${table}" WHERE word_id = ?`, [id], 0) > 0)
    || firstValue<number>("SELECT COUNT(*) FROM content_favorites WHERE item_type = 'word' AND item_id = ?", [String(id)], 0) > 0
    || getState("current_card", "") === String(id);
  removed.forEach(({ surface, kana }) => {
    rowsFor("SELECT id FROM words WHERE kanji = ? AND kana = ? AND pos = '固定搭配'", [surface, kana])
      .map((row) => Number(row.id))
      .forEach((id) => {
        if (touched(id)) {
          knowable.forEach((table) => db.run(`UPDATE "${table}" SET known_forever = 1 WHERE word_id = ? AND known_forever = 0`, [id]));
          return;
        }
        db.run("DELETE FROM progress WHERE word_id = ?", [id]);
        db.run("DELETE FROM words WHERE id = ?", [id]);
      });
  });
};

