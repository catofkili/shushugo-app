import { getDatabase } from "./database";
import { ensureProgressInitialized } from "./word-api";
import { firstRow, firstValue, persistSoon, setState, today } from "./study-core";
import { notifyProgressUpdated } from "./progress-events";

type ImportRecord = Record<string, unknown>;

export interface ExternalWordDraft {
  term: string;
  kana: string;
  kanji: string;
  meaning: string;
  pos: string;
  verbType: string | null;
  importance: number;
  exampleJp: string;
  exampleMeaning: string;
  jlptLevel: string | null;
  memoryScore: number;
  seenCount: number;
  rightCount: number;
  fuzzyCount: number;
  forgotCount: number;
  lowHistory: number;
  lastSeenOn: string | null;
  note: string;
}

export interface WordListImportPreview {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  skippedRows: number;
  samples: ExternalWordDraft[];
  warnings: string[];
}

export interface WordListImportResult extends WordListImportPreview {
  inserted: number;
  updated: number;
  queuedForReview: number;
}

const KNOWN_HEADERS = new Set([
  "word", "term", "title", "entry", "spell", "surface", "headword",
  "单词", "單詞", "词", "詞", "词条", "詞條", "表记", "表記", "見出し", "日文",
  "kana", "reading", "yomi", "pronunciation", "pron", "假名", "かな", "仮名", "读音", "読み",
  "meaning", "translation", "definition", "explain", "briefInfo", "excerpt", "释义", "释意", "中文", "意思", "翻译",
  "score", "memory", "熟悉度", "熟知度", "记忆", "記憶", "做题分数", "正确率"
]);

const FIELD_ALIASES = {
  term: ["word", "term", "title", "entry", "spell", "surface", "headword", "单词", "單詞", "词", "詞", "词条", "詞條", "表记", "表記", "見出し", "日文"],
  kana: ["kana", "reading", "yomi", "pronunciation", "pron", "假名", "かな", "仮名", "读音", "読み", "発音", "发音"],
  meaning: ["meaning", "translation", "definition", "explain", "briefInfo", "excerpt", "释义", "释意", "中文", "意思", "翻译", "訳", "訳文", "中国語"],
  pos: ["pos", "partofspeech", "品词", "品詞", "词性", "詞性"],
  exampleJp: ["examplejp", "example", "sentence", "例句", "例文", "日文例句"],
  exampleMeaning: ["examplemeaning", "examplecn", "例句翻译", "例句释义", "中文例句"],
  jlptLevel: ["jlpt", "level", "等级", "級別", "级别", "難度", "难度"],
  note: ["note", "memo", "notes", "笔记", "筆記", "备注", "備考"],
  score: ["score", "memoryscore", "熟悉度", "熟知度", "记忆分", "記憶分", "做题分数", "正确率", "正答率", "掌握度"],
  seenCount: ["seencount", "reviewcount", "testcount", "qcnt", "testtimes", "次数", "复习次数", "测试次数", "做题次数"],
  rightCount: ["rightcount", "correctcount", "正确", "正确数", "会了"],
  fuzzyCount: ["fuzzycount", "halfcount", "模糊", "犹豫"],
  forgotCount: ["forgotcount", "wrongcount", "incorrectcount", "qwrcnt", "错误", "错题", "忘记", "不会"],
  lastSeenOn: ["lastseenon", "reviewedon", "updatedat", "最后复习", "上次复习", "最近学习"]
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s_\-()[\]（）【】:：/\\.,，。]/g, "");
const cleanText = (value: unknown) => String(value ?? "").replace(/\uFEFF/g, "").trim();
const hasJapanese = (value: string) => /[\u3040-\u30ff\u3400-\u9fff々〆〤]/.test(value);
const kanaOnly = (value: string) => /^[\u3040-\u30ffー・〜~\s]+$/.test(value.trim());

const getByAliases = (record: ImportRecord, aliases: string[]) => {
  const normalized = new Map(Object.keys(record).map((key) => [normalizeKey(key), key]));
  for (const alias of aliases) {
    const key = normalized.get(normalizeKey(alias));
    if (key) {
      const value = cleanText(record[key]);
      if (value) return value;
    }
  }
  return "";
};

const parseCsv = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.filter((items) => items.some(Boolean));
};

const detectDelimiter = (text: string) => {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const delimiters = ["\t", ",", ";", "|"];
  return delimiters
    .map((delimiter) => ({ delimiter, count: sample.split(delimiter).length - 1 }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? "\t";
};

const looksLikeHeader = (row: string[]) => {
  const matches = row.filter((cell) => KNOWN_HEADERS.has(normalizeKey(cell))).length;
  return matches >= 1 || row.filter((cell) => !hasJapanese(cell) && /[a-zA-Z]/.test(cell)).length >= Math.max(2, row.length / 2);
};

const csvRecords = (text: string): ImportRecord[] => {
  const rows = parseCsv(text, detectDelimiter(text));
  if (!rows.length) return [];
  if (looksLikeHeader(rows[0])) {
    const headers = rows[0].map((header, index) => cleanText(header) || `column_${index + 1}`);
    return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }
  return rows.map((row) => Object.fromEntries(row.map((value, index) => [`column_${index + 1}`, value])));
};

const flattenJson = (value: unknown): ImportRecord[] => {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJson);
  }
  if (!value || typeof value !== "object") return [];
  const record = value as ImportRecord;
  const nestedKey = ["words", "items", "list", "data", "records", "vocabulary"].find((key) => Array.isArray(record[key]));
  if (nestedKey) return flattenJson(record[nestedKey]);
  return [record];
};

const textRecords = (text: string): ImportRecord[] => {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const lines = blocks.length > 1 ? blocks : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/\t| {2,}|,|，|、/).map((part) => part.trim()).filter(Boolean);
    return Object.fromEntries(parts.map((part, index) => [`column_${index + 1}`, part]));
  });
};

export const parseExternalWordListText = (text: string): ImportRecord[] => {
  const normalized = text.replace(/\uFEFF/g, "").trim();
  if (!normalized) return [];
  if (/^[\[{]/.test(normalized)) {
    try {
      const rows = flattenJson(JSON.parse(normalized));
      if (rows.length) return rows;
    } catch {
      // Fall through to text parsing. Some exports start with braces in notes.
    }
  }
  const rows = csvRecords(normalized);
  return rows.length ? rows : textRecords(normalized);
};

const chooseJapaneseFields = (record: ImportRecord) => {
  const values = Object.values(record).map(cleanText).filter(Boolean);
  const japanese = values.filter(hasJapanese);
  const kana = getByAliases(record, FIELD_ALIASES.kana) || japanese.find((value) => kanaOnly(value)) || "";
  const term = getByAliases(record, FIELD_ALIASES.term) || japanese.find((value) => !kanaOnly(value)) || kana || "";
  const meaning = getByAliases(record, FIELD_ALIASES.meaning) || values.find((value) => !hasJapanese(value) && value.length > 1) || "";
  return { term, kana, meaning };
};

const parseNumber = (value: string) => {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const parseDate = (value: string) => {
  const match = value.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/);
  if (!match) return null;
  const [year, month, day] = match[0].split(/\D+/).map(Number);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const scoreFromRecord = (record: ImportRecord) => {
  const raw = getByAliases(record, FIELD_ALIASES.score);
  const joined = Object.values(record).map(cleanText).join(" ");
  const numeric = parseNumber(raw);
  if (numeric !== null) {
    if (numeric >= -40 && numeric <= 10) return Math.round(numeric);
    const percent = numeric <= 1 ? numeric * 100 : numeric;
    if (percent >= 0 && percent <= 100) return Math.max(-15, Math.min(10, Math.round((percent - 60) / 4)));
  }
  if (/已掌握|完全记住|熟知|known|master/i.test(joined)) return 8;
  if (/模糊|一般|fuzzy|again/i.test(joined)) return -2;
  if (/忘记|不会|错误|错题|forgot|wrong/i.test(joined)) return -10;
  return 0;
};

const inferPos = (term: string, explicit: string) => {
  if (explicit) return explicit;
  if (/する$/.test(term)) return "名词・する动词";
  if (/[うくぐすつぬぶむる]$/.test(term)) return "动词";
  if (/い$/.test(term) && !kanaOnly(term)) return "い形容词";
  return "导入词";
};

const inferVerbType = (term: string, pos: string) => {
  if (/する/.test(term) || /suru|する/.test(pos)) return "suru";
  if (/动词|動詞/.test(pos)) return /る$/.test(term) ? "ichidan" : "godan";
  return null;
};

const normalizeDraft = (record: ImportRecord): ExternalWordDraft | null => {
  const { term, kana, meaning } = chooseJapaneseFields(record);
  if (!term || !hasJapanese(term)) return null;
  const cleanTerm = term.replace(/\s+/g, "");
  const cleanKana = (kana || (kanaOnly(cleanTerm) ? cleanTerm : "")).replace(/\s+/g, "");
  const kanji = cleanTerm;
  const reading = cleanKana || cleanTerm;
  const score = scoreFromRecord(record);
  const seenCount = Math.max(
    parseNumber(getByAliases(record, FIELD_ALIASES.seenCount)) ?? 0,
    score === 0 ? 0 : 1
  );
  const rightCount = Math.max(parseNumber(getByAliases(record, FIELD_ALIASES.rightCount)) ?? 0, score > 4 ? 1 : 0);
  const fuzzyCount = Math.max(parseNumber(getByAliases(record, FIELD_ALIASES.fuzzyCount)) ?? 0, score < 4 && score > -8 ? 1 : 0);
  const forgotCount = Math.max(parseNumber(getByAliases(record, FIELD_ALIASES.forgotCount)) ?? 0, score <= -8 ? 1 : 0);
  const pos = inferPos(cleanTerm, getByAliases(record, FIELD_ALIASES.pos));

  return {
    term: cleanTerm,
    kana: reading,
    kanji,
    meaning: meaning || "自定义导入",
    pos,
    verbType: inferVerbType(cleanTerm, pos),
    importance: Math.max(1, Math.min(5, score <= -8 ? 5 : score <= 2 ? 4 : 3)),
    exampleJp: getByAliases(record, FIELD_ALIASES.exampleJp),
    exampleMeaning: getByAliases(record, FIELD_ALIASES.exampleMeaning),
    jlptLevel: getByAliases(record, FIELD_ALIASES.jlptLevel).match(/N[1-5]/i)?.[0].toUpperCase() ?? null,
    memoryScore: score,
    seenCount,
    rightCount,
    fuzzyCount,
    forgotCount,
    lowHistory: score <= -10 ? 1 : 0,
    lastSeenOn: parseDate(getByAliases(record, FIELD_ALIASES.lastSeenOn)),
    note: getByAliases(record, FIELD_ALIASES.note)
  };
};

export const previewExternalWordList = (text: string): WordListImportPreview => {
  const records = parseExternalWordListText(text);
  const seen = new Set<string>();
  const drafts: ExternalWordDraft[] = [];
  let duplicateRows = 0;
  let skippedRows = 0;

  records.forEach((record) => {
    const draft = normalizeDraft(record);
    if (!draft) {
      skippedRows += 1;
      return;
    }
    const key = `${draft.kanji}\u0000${draft.kana}`;
    if (seen.has(key)) {
      duplicateRows += 1;
      return;
    }
    seen.add(key);
    drafts.push(draft);
  });

  const warnings: string[] = [];
  if (records.length && drafts.length / records.length < 0.5) {
    warnings.push("可识别行偏少，请确认文件里有日文词条和释义列。");
  }
  if (drafts.some((draft) => draft.meaning === "自定义导入")) {
    warnings.push("部分词没有识别到中文释义，已用占位释义导入。");
  }

  return {
    totalRows: records.length,
    validRows: drafts.length,
    duplicateRows,
    skippedRows,
    samples: drafts.slice(0, 5),
    warnings
  };
};

const findWordId = (kanji: string, kana: string) => {
  return firstValue<number>("SELECT id FROM words WHERE kanji = ? AND kana = ?", [kanji, kana], 0)
    || firstValue<number>("SELECT id FROM words WHERE kanji = ? OR kana = ? LIMIT 1", [kanji, kana], 0);
};

const reviewPriority = (draft: ExternalWordDraft) => {
  return Math.max(0, 8 - draft.memoryScore) + draft.forgotCount * 2 + draft.fuzzyCount + Math.min(draft.seenCount, 20) / 10;
};

export const importExternalWordList = (text: string): WordListImportResult => {
  ensureProgressInitialized();
  const preview = previewExternalWordList(text);
  const drafts = parseExternalWordListText(text).map(normalizeDraft).filter((draft): draft is ExternalWordDraft => Boolean(draft));
  const db = getDatabase();
  const importedOn = today();
  let inserted = 0;
  let updated = 0;
  let queuedForReview = 0;
  const applied = new Set<string>();

  db.run("BEGIN TRANSACTION");
  try {
    drafts.forEach((draft) => {
      const key = `${draft.kanji}\u0000${draft.kana}`;
      if (applied.has(key)) return;
      applied.add(key);

      let wordId = findWordId(draft.kanji, draft.kana);
      if (!wordId) {
        db.run(`
          INSERT INTO words (
            meaning, kana, kanji, pos, verb_type, importance,
            shuffle_rank, example_jp, example_meaning, jlpt_level
          )
          VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?)
        `, [
          draft.meaning, draft.kana, draft.kanji, draft.pos, draft.verbType,
          draft.importance, draft.exampleJp, draft.exampleMeaning, draft.jlptLevel
        ]);
        wordId = firstValue<number>("SELECT last_insert_rowid()", [], 0);
        inserted += 1;
      } else {
        db.run(`
          UPDATE words
          SET meaning = CASE WHEN meaning = '' OR meaning = '自定义导入' THEN ? ELSE meaning END,
              pos = CASE WHEN pos = '' OR pos = '导入词' THEN ? ELSE pos END,
              verb_type = COALESCE(verb_type, ?),
              importance = MAX(importance, ?),
              example_jp = COALESCE(NULLIF(example_jp, ''), ?),
              example_meaning = COALESCE(NULLIF(example_meaning, ''), ?),
              jlpt_level = COALESCE(jlpt_level, ?)
          WHERE id = ?
        `, [
          draft.meaning, draft.pos, draft.verbType, draft.importance,
          draft.exampleJp, draft.exampleMeaning, draft.jlptLevel, wordId
        ]);
        updated += 1;
      }

      const current = firstRow("SELECT * FROM progress WHERE word_id = ?", [wordId]);
      const shouldApplyMemory = !current
        || Number(current.known_forever ?? 0) === 0
        && (Number(current.seen_count ?? 0) === 0 || draft.memoryScore < Number(current.score ?? 0));
      db.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)", [wordId]);
      if (shouldApplyMemory) {
        db.run(`
          UPDATE progress
          SET score = ?,
              seen_count = MAX(seen_count, ?),
              low_history = MAX(low_history, ?),
              known_forever = 0,
              mastered_on = CASE WHEN ? >= 10 THEN ? ELSE NULL END,
              last_seen_on = COALESCE(?, last_seen_on),
              right_count = MAX(right_count, ?),
              fuzzy_count = MAX(fuzzy_count, ?),
              forgot_count = MAX(forgot_count, ?),
              mistake_streak = CASE WHEN ? <= -8 THEN MAX(mistake_streak, 1) ELSE mistake_streak END
          WHERE word_id = ?
        `, [
          draft.memoryScore, draft.seenCount, draft.lowHistory,
          draft.memoryScore, importedOn, draft.lastSeenOn ?? importedOn,
          draft.rightCount, draft.fuzzyCount, draft.forgotCount,
          draft.memoryScore, wordId
        ]);
      }

      if (draft.note) {
        db.run(`
          INSERT INTO word_notes (word_id, note, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(word_id) DO UPDATE SET
            note = CASE
              WHEN word_notes.note = '' THEN excluded.note
              WHEN instr(word_notes.note, excluded.note) > 0 THEN word_notes.note
              ELSE word_notes.note || char(10) || excluded.note
            END,
            updated_at = CURRENT_TIMESTAMP
        `, [wordId, draft.note]);
      }

      if (draft.seenCount > 0 && draft.memoryScore <= 6) {
        db.run(`
          INSERT INTO moji_migrated_reviews (word_id, imported_on, priority, activated_on)
          VALUES (?, ?, ?, NULL)
          ON CONFLICT(word_id) DO UPDATE SET
            imported_on = excluded.imported_on,
            priority = MAX(priority, excluded.priority),
            activated_on = NULL
        `, [wordId, importedOn, reviewPriority(draft)]);
        queuedForReview += 1;
      }
    });
    setState("external_word_list_last_import", JSON.stringify({ importedOn, inserted, updated, queuedForReview }));
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  persistSoon();
  notifyProgressUpdated();
  return { ...preview, inserted, updated, queuedForReview };
};
