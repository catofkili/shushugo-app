import { LEECH_SQL, MASTERED_SQL, ensureFsrsColumns } from "./fsrs-store";
import { rowsFor, studyDayEnd, type DbRow, type SqlValue } from "./study-core";
import { ensureProgressInitialized } from "./word-api";

/**
 * 词库浏览（「选词」页）的取数层。
 *
 * 这一页要能一次面对 11,000 条词，所以筛选、排序、分页**全在 SQL 里**做，
 * 页面只拿当前那 100 行。别学疑难辨析页把全部结果铺进 DOM ——
 * 那页 1,933 张卡还扛得住，一万一千行在真机上会卡死。
 *
 * 口径全部沿用既有定义，不新造第四套账：
 *   已掌握 = MASTERED_SQL（间隔 ≥ 180 天）或 known_forever
 *   顽固词 = LEECH_SQL（lapses ≥ 8）
 *   到期   = 本学习日内到期；但**未学的词不算到期** —— 全局口径里 fsrs_due IS NULL
 *            视同到期，那是给出题池用的，在词库里会把 8,900 条没碰过的词全染红。
 */

/**
 * 记忆档。说的是「这个词还能记多久」（FSRS stability），不是「今天该不该复习」。
 *
 * 刻意不用「当前回忆概率 R」：R 会随时间下滑，同一个词今天红、复习完变绿，
 * 翻词库时看到的就成了排期而不是记忆。到期与否另外用角标说。
 *
 * 分档按对数拉开：用户 2,092 个学过的词里，stability 从 <1 天到 90 天+ 都有分布
 * （137 / 201 / 363 / 674 / 461 / 256），拿 180 天当满绿的话整页只会是红黄一片。
 */
export type MemoryBand = "mastered" | "d5" | "d4" | "d3" | "d2" | "d1" | "d0" | "unseen";

export interface MemoryBandMeta {
  id: MemoryBand;
  /** 芯片上的短名 */
  label: string;
  /** 一句人话：这一档意味着什么 */
  hint: string;
}

/** 从强到弱，未学垫底 —— 分布带就按这个顺序铺 */
export const MEMORY_BANDS: MemoryBandMeta[] = [
  { id: "mastered", label: "已掌握", hint: "间隔已经拉到半年以上，或你手动标了熟知" },
  { id: "d5", label: "3 个月+", hint: "记得很牢，三个月后才需要再看一眼" },
  { id: "d4", label: "1–3 个月", hint: "稳固，长间隔复习中" },
  { id: "d3", label: "1–3 周", hint: "正在变熟" },
  { id: "d2", label: "3–7 天", hint: "还不牢，隔几天就会忘" },
  { id: "d1", label: "1–3 天", hint: "生疏，撑不过几天" },
  { id: "d0", label: "不到 1 天", hint: "基本没记住，明天就会忘" },
  { id: "unseen", label: "未学", hint: "还没学过这个词" }
];

export const bandMeta = (band: MemoryBand): MemoryBandMeta =>
  MEMORY_BANDS.find((item) => item.id === band) ?? MEMORY_BANDS[MEMORY_BANDS.length - 1];

/** 词性归一化桶。词库里 pos 有 48 种写法（名词/名/名·サ变/名词・する动词…是几批来源混出来的），
 *  直接拿去做筛选菜单会列出 48 个选项，所以先收敛成七类。 */
export type PosBucket = "noun" | "suru" | "verb" | "adj" | "adv" | "pron" | "affix" | "other";

export const POS_BUCKETS: { id: PosBucket; label: string }[] = [
  { id: "noun", label: "名词" },
  { id: "suru", label: "する动词" },
  { id: "verb", label: "动词" },
  { id: "adj", label: "形容词" },
  { id: "adv", label: "副词" },
  { id: "pron", label: "代词·连体" },
  { id: "affix", label: "接辞·助词" },
  { id: "other", label: "感叹·惯用·其他" }
];

/** 顺序有意义：先认サ变（「名·他动·サ变」是する动词不是动词），再形容词，再动词，最后才看「名」开头。 */
export const classifyPos = (raw: string): PosBucket => {
  const text = (raw ?? "").trim();
  if (!text) return "other";
  if (/サ变|サ変|する/.test(text)) return "suru";
  if (/形容词|形容詞|形动|形動|^形$/.test(text)) return "adj";
  if (/动词|動詞|他动|自动|他動|自動/.test(text)) return "verb";
  if (/^名|^代名/.test(text)) return "noun";
  if (/副词|副詞/.test(text)) return "adv";
  if (/^代|連体|连体/.test(text)) return "pron";
  if (/接尾|接頭|接头|^接|造|助$|助词|格助|終助|接助|助动/.test(text)) return "affix";
  return "other";
};

let posCache: Map<PosBucket, string[]> | null = null;

/** 建一次「桶 → 原始 pos 字符串」的对照表，筛选时展开成 IN (...)。导入新词表后失效即可。 */
const posLookup = (): Map<PosBucket, string[]> => {
  if (posCache) return posCache;
  const map = new Map<PosBucket, string[]>();
  rowsFor("SELECT DISTINCT pos FROM words").forEach((row) => {
    const raw = String(row.pos ?? "");
    const bucket = classifyPos(raw);
    const list = map.get(bucket) ?? [];
    list.push(raw);
    map.set(bucket, list);
  });
  posCache = map;
  return map;
};

export const resetWordLibraryCaches = () => {
  posCache = null;
};

export type LibraryLevel = "all" | "N5" | "N4" | "N3" | "N2" | "N1" | "unranked";
export type LibraryBandFilter = MemoryBand | "all" | "due" | "leech";
export type LibrarySort = "level" | "weakest" | "recent" | "kana";

export interface WordLibraryFilters {
  level: LibraryLevel;
  band: LibraryBandFilter;
  pos: PosBucket | "all";
  search: string;
  sort: LibrarySort;
}

export const DEFAULT_LIBRARY_FILTERS: WordLibraryFilters = {
  level: "all",
  band: "all",
  pos: "all",
  search: "",
  sort: "level"
};

export interface WordLibraryRow {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  pos: string;
  posBucket: PosBucket;
  level: string;
  band: MemoryBand;
  /** FSRS stability（天）。未学或手动标熟知的没有 */
  stability: number | null;
  /** 下次到期（ISO）。没进过调度的为 null */
  dueAt: string | null;
  lastReview: string | null;
  lapses: number;
  reps: number;
  isDue: boolean;
  isLeech: boolean;
  /** 手动点过「熟知」——已经退出队列，和「间隔排到半年以外」的已掌握不是一回事 */
  isKnownForever: boolean;
}

const BAND_SQL = `
  CASE
    WHEN p.known_forever = 1 OR ${MASTERED_SQL} THEN 'mastered'
    WHEN p.seen_count = 0 THEN 'unseen'
    WHEN p.fsrs_stability IS NULL THEN 'd0'
    WHEN p.fsrs_stability < 1 THEN 'd0'
    WHEN p.fsrs_stability < 3 THEN 'd1'
    WHEN p.fsrs_stability < 7 THEN 'd2'
    WHEN p.fsrs_stability < 21 THEN 'd3'
    WHEN p.fsrs_stability < 90 THEN 'd4'
    ELSE 'd5'
  END
`;

/** 词库里的「到期」：只算学过的词。未学的词 fsrs_due 也是 NULL，但那不是「该复习」。 */
const DUE_IN_LIBRARY_SQL = `
  (p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))
`;

const LEVEL_ORDER_SQL =
  "CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END";

type Where = { sql: string; params: SqlValue[] };

/** band 之外的筛选条件。分布带要在「其它条件都生效、唯独不筛档」的集合上统计。 */
const baseWhere = (filters: WordLibraryFilters): Where => {
  const clauses: string[] = [];
  const params: SqlValue[] = [];

  if (filters.level === "unranked") {
    clauses.push("(w.jlpt_level IS NULL OR w.jlpt_level NOT IN ('N5','N4','N3','N2','N1'))");
  } else if (filters.level !== "all") {
    clauses.push("w.jlpt_level = ?");
    params.push(filters.level);
  }

  if (filters.pos !== "all") {
    const raws = posLookup().get(filters.pos) ?? [];
    if (raws.length === 0) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`w.pos IN (${raws.map(() => "?").join(",")})`);
      raws.forEach((raw) => params.push(raw));
    }
  }

  const text = filters.search.trim();
  if (text) {
    const like = `%${text}%`;
    clauses.push("(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ?)");
    params.push(like, like, like);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
};

const withBand = (filters: WordLibraryFilters, dayEnd: string): Where => {
  const base = baseWhere(filters);
  if (filters.band === "all") return base;

  let clause = "";
  const params: SqlValue[] = [];
  if (filters.band === "due") {
    clause = DUE_IN_LIBRARY_SQL;
    params.push(dayEnd);
  } else if (filters.band === "leech") {
    clause = LEECH_SQL.replace(/fsrs_lapses/g, "p.fsrs_lapses");
  } else {
    clause = `${BAND_SQL} = ?`;
    params.push(filters.band);
  }

  const sql = base.sql ? `${base.sql} AND ${clause}` : `WHERE ${clause}`;
  return { sql, params: [...base.params, ...params] };
};

const ORDER_SQL: Record<LibrarySort, string> = {
  level: `${LEVEL_ORDER_SQL} ASC, w.importance DESC, w.id ASC`,
  // 学过的词按 stability 升序（最弱在最前），没学过的整体沉底
  weakest: `CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END ASC,
            COALESCE(p.fsrs_stability, 999999) ASC, w.importance DESC, w.id ASC`,
  recent: `CASE WHEN p.fsrs_last_review IS NULL THEN 1 ELSE 0 END ASC, p.fsrs_last_review DESC, w.id ASC`,
  kana: "w.kana ASC, w.id ASC"
};

const toRow = (row: DbRow): WordLibraryRow => {
  const pos = String(row.pos ?? "");
  return {
    id: Number(row.id ?? 0),
    kanji: String(row.kanji ?? ""),
    kana: String(row.kana ?? ""),
    meaning: String(row.meaning ?? ""),
    pos,
    posBucket: classifyPos(pos),
    level: String(row.jlpt_level ?? "") || "未分级",
    band: String(row.band ?? "unseen") as MemoryBand,
    stability: row.fsrs_stability === null || row.fsrs_stability === undefined ? null : Number(row.fsrs_stability),
    dueAt: row.fsrs_due ? String(row.fsrs_due) : null,
    lastReview: row.fsrs_last_review ? String(row.fsrs_last_review) : null,
    lapses: Number(row.fsrs_lapses ?? 0),
    reps: Number(row.fsrs_reps ?? 0),
    isDue: Number(row.is_due ?? 0) === 1,
    isLeech: Number(row.fsrs_lapses ?? 0) >= 8,
    isKnownForever: Number(row.known_forever ?? 0) === 1
  };
};

const prepare = () => {
  ensureProgressInitialized();
  ensureFsrsColumns();
};

/** 取一页。offset/limit 直接进 SQL，别在 JS 里 slice 全表。 */
export function queryWordLibrary(
  filters: WordLibraryFilters,
  offset: number,
  limit: number
): WordLibraryRow[] {
  prepare();
  const dayEnd = studyDayEnd().toISOString();
  const where = withBand(filters, dayEnd);
  return rowsFor(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${BAND_SQL} AS band,
      CASE WHEN ${DUE_IN_LIBRARY_SQL} THEN 1 ELSE 0 END AS is_due
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${where.sql}
    ORDER BY ${ORDER_SQL[filters.sort]}
    LIMIT ? OFFSET ?
  `, [dayEnd, ...where.params, limit, offset]).map(toRow);
}

export interface WordLibraryTally {
  total: number;
  /** 当前筛选（不含记忆档）下各档的条数 */
  bands: Record<MemoryBand, number>;
  due: number;
  leech: number;
}

const emptyBands = (): Record<MemoryBand, number> =>
  MEMORY_BANDS.reduce((acc, item) => ({ ...acc, [item.id]: 0 }), {} as Record<MemoryBand, number>);

/** 分布带 + 计数。一条 GROUP BY 全部拿到，别为每个档各发一次 COUNT。 */
export function tallyWordLibrary(filters: WordLibraryFilters): WordLibraryTally {
  prepare();
  const dayEnd = studyDayEnd().toISOString();
  const where = baseWhere(filters);
  const bands = emptyBands();
  let total = 0;
  let due = 0;
  let leech = 0;

  rowsFor(`
    SELECT
      ${BAND_SQL} AS band,
      COUNT(*) AS n,
      SUM(CASE WHEN ${DUE_IN_LIBRARY_SQL} THEN 1 ELSE 0 END) AS due_n,
      SUM(CASE WHEN ${LEECH_SQL.replace(/fsrs_lapses/g, "p.fsrs_lapses")} THEN 1 ELSE 0 END) AS leech_n
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${where.sql}
    GROUP BY band
  `, [dayEnd, ...where.params]).forEach((row) => {
    const band = String(row.band ?? "unseen") as MemoryBand;
    const n = Number(row.n ?? 0);
    if (band in bands) bands[band] = n;
    total += n;
    due += Number(row.due_n ?? 0);
    leech += Number(row.leech_n ?? 0);
  });

  return { total, bands, due, leech };
}

export interface WordLibraryDetail extends WordLibraryRow {
  example: { jp: string; meaning: string };
  note: string;
  isFavorite: boolean;
}

/** 词条详情。只读：进这里不改 FSRS、不进当日计划，纯粹当词典翻。 */
export function wordLibraryDetail(wordId: number): WordLibraryDetail | null {
  prepare();
  const dayEnd = studyDayEnd().toISOString();
  const row = rowsFor(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level, w.example_jp, w.example_meaning,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${BAND_SQL} AS band,
      CASE WHEN ${DUE_IN_LIBRARY_SQL} THEN 1 ELSE 0 END AS is_due,
      COALESCE(n.note, '') AS note,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    LEFT JOIN content_favorites f ON f.item_type = 'word' AND f.item_id = CAST(w.id AS TEXT)
    WHERE w.id = ?
    LIMIT 1
  `, [dayEnd, wordId])[0];
  if (!row) return null;
  return {
    ...toRow(row),
    example: { jp: String(row.example_jp ?? ""), meaning: String(row.example_meaning ?? "") },
    note: String(row.note ?? ""),
    isFavorite: Number(row.favorite ?? 0) === 1
  };
}

/** 当前筛选下的全部词 id —— 「全选」用。上限挡一下，别让一次勾中一万条。 */
export function wordLibraryIds(filters: WordLibraryFilters, limit = 500): number[] {
  prepare();
  const dayEnd = studyDayEnd().toISOString();
  const where = withBand(filters, dayEnd);
  return rowsFor(`
    SELECT w.id
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${where.sql}
    ORDER BY ${ORDER_SQL[filters.sort]}
    LIMIT ?
  `, [...where.params, limit]).map((row) => Number(row.id ?? 0));
}
