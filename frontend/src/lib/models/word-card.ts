import type { Database } from "sql.js";
import { getDatabase } from "../database";
import { WordCard } from "../../types/vocabulary";
import { DbRow, SqlValue } from "../database/db-utils";
import { confusionCandidates } from "./confusion";
import kanjiVariantPayload from "../../data/kanji_variants.json";
import verbPairHintPayload from "../../data/verb_pair_hints.json";

type VerbPairHint = readonly [voice: string, pairKanji: string, pairKana: string, note: string];

const kanjiVariants = (kanjiVariantPayload as { japanese_to_simplified?: Record<string, string> })
  .japanese_to_simplified ?? {};

const verbPairHints = Object.fromEntries(
  Object.entries(verbPairHintPayload as Record<string, string[]>).flatMap(([key, value]) => {
    if (value.length < 4) return [];
    return [[key, [value[0], value[1], value[2], value[3]] as VerbPairHint]];
  })
) as Record<string, VerbPairHint>;

const shortMeaningOverrides: Record<number, string> = {
  596: "敬称",
  750: "职业者",
  847: "对象地点",
  952: "天妇罗",
  1519: "店铺人员",
  1528: "收信地址",
  2008: "种类数",
  2084: "干炸食品",
  2138: "操作",
  2280: "事情件数",
  2303: "法国",
  2340: "卡丁车",
  2358: "体育中心",
  2379: "儿童节",
  2392: "聚会",
  2398: "广岛",
  2401: "维生素剂",
  2425: "高级公寓",
  2428: "邮箱地址",
  2446: "昵称后缀",
  2464: "不久",
  2480: "大楼",
  2494: "路上小心",
  2495: "请多关照",
  2519: "打工",
  2524: "各种各样",
  2525: "神户",
  2539: "威士忌",
  2579: "根据",
  2582: "君称",
  2624: "各种各样"
};

const kanjiMeaningOverrides: Record<string, string> = {
  "講座": "讲座",
  "緑茶": "绿茶",
  "色鉛筆": "彩色铅笔",
  "富士山": "富士山",
  "地味": "朴素",
  "派手": "花哨",
  "初詣": "新年参拜"
};

/**
 * 检查是否是汉字
 */
export function isKanji(char: string): boolean {
  return char >= "一" && char <= "鿿";
}

/**
 * 检查文本是否包含汉字
 */
export function hasKanjiText(text: string): boolean {
  return Array.from(text).some(isKanji);
}

/**
 * 构建汉字组件信息
 */
export function buildKanjiComponents(text: string): WordCard["kanjiComponents"] {
  const seen = new Set<string>();

  return Array.from(text).flatMap((char) => {
    if (!isKanji(char) || seen.has(char)) return [];
    seen.add(char);

    const simplified = kanjiVariants[char] ?? char;
    return [{
      char,
      simplified,
      marked: simplified !== char,
      source: "auto"
    }];
  });
}

/**
 * 查找配对单词
 */
function findPairWord(db: Database, pairKanji: string, pairKana: string): {
  kana: string;
  kanji: string;
  meaning: string;
} | null {
  const result = db.exec(`
    SELECT kana, kanji, meaning
    FROM words
    WHERE kana = ? OR kanji = ?
    ORDER BY CASE WHEN kanji = ? THEN 0 ELSE 1 END
    LIMIT 1
  `, [pairKana, pairKanji, pairKanji]);

  if (!result.length || !result[0].values.length) return null;
  const [kana, kanji, meaning] = result[0].values[0] as SqlValue[];
  return {
    kana: String(kana ?? pairKana),
    kanji: String(kanji ?? pairKanji),
    meaning: String(meaning ?? "")
  };
}

/**
 * 构建自他动词配对信息
 */
export function buildVerbPair(db: Database, kanji: string, kana: string): WordCard["verbPair"] {
  const key = kanji in verbPairHints ? kanji : kana;
  const hint = verbPairHints[key];
  if (!hint) return null;

  const [voice, pairKanji, pairKana, note] = hint;
  const pair = findPairWord(db, pairKanji, pairKana);

  return {
    voice,
    pairVoice: voice === "他动词" ? "自动词" : "他动词",
    kana: pair?.kana ?? pairKana,
    kanji: pair?.kanji ?? pairKanji,
    meaning: pair?.meaning ?? "",
    note
  };
}

/**
 * 提取主要释义
 */
export function primaryMeaning(meaning: string): string {
  for (const separator of ["；", ";", "，"]) {
    if (meaning.includes(separator)) return meaning.split(separator, 1)[0].trim();
  }
  return meaning.trim();
}

/**
 * 生成提示释义（用于题目）
 */
export function promptMeaning(meaning: string, wordId: number, kanji: string): string {
  if (shortMeaningOverrides[wordId]) return shortMeaningOverrides[wordId];
  if (kanjiMeaningOverrides[kanji]) return kanjiMeaningOverrides[kanji];
  const text = meaning.trim();
  if (!text) return "";
  const parts = text.split(/[；;，,]/).map((part) => part.trim()).filter(Boolean).slice(0, 3);
  let short = parts[0] || text;
  short = short.replace(/^[⓪①②③④⑤⑥⑦⑧⑨⑩]+/, "").trim();
  let previous = "";
  while (previous !== short) {
    previous = short;
    short = short.replace(/^[（(][^）)]{1,40}[）)]/, "").trim();
  }
  short = short.replace(/^[A-Za-z][A-Za-z\s.／/-]*/, "").trim();
  short = short.replace(/^[〈《][^〉》]{1,20}[〉》]/, "").trim();
  if (short.includes("。")) short = short.split("。", 1)[0].trim();
  if (kanji && kanji.length <= 5 && !/[ぁ-ゟァ-ヿA-Za-z〜～]/.test(kanji)) {
    let prefix = "";
    Array.from(short).some((textChar, index) => {
      if (textChar !== Array.from(kanji)[index]) return true;
      prefix += textChar;
      return false;
    });
    if (prefix.length >= 2) short = prefix;
  }
  return short.slice(0, 8);
}

/**
 * 检查是否收藏
 */
export function isFavorite(type: 'word' | 'grammar', id: string | number): boolean {
  const result = getDatabase().exec(
    "SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",
    [type, String(id)]
  );
  return result.length > 0 && result[0].values.length > 0;
}

/**
 * 计算错误分数
 */
export function mistakeScore(row: DbRow): number {
  const wrongish = Number(row.forgot_count ?? 0) * 2 + Number(row.fuzzy_count ?? 0);
  const total = wrongish + Number(row.right_count ?? 0);
  if (total === 0) return 0;
  const streakBonus = Math.min(Number(row.mistake_streak ?? 0) * 0.08, 0.32);
  return Math.min(wrongish / total + streakBonus, 1);
}

/**
 * 将数据库行转换为单词卡片对象
 */
export function rowObjectToCard(row: DbRow): WordCard {
  const id = Number(row.id ?? row.word_id ?? 0);
  const meaning = String(row.meaning ?? "");
  const kana = String(row.kana ?? "");
  const label = String(row.kanji || kana);
  const importance = Number(row.importance ?? 3);
  const personalMistakeScore = mistakeScore(row);

  return {
    id,
    meaning,
    primaryMeaning: primaryMeaning(meaning),
    promptMeaning: promptMeaning(meaning, id, label),
    kana,
    kanji: label,
    pos: String(row.pos ?? ""),
    jlptLevel: String(row.jlpt_level ?? ""),
    score: Number(row.score ?? 0),
    importance,
    importanceScore: Math.round(Math.min(Math.max(importance * 1.4 + personalMistakeScore * 3, 0), 10) * 10) / 10,
    isFavorite: isFavorite("word", id),
    note: String(row.note ?? ""),
    example: {
      jp: String(row.example_jp ?? ""),
      meaning: String(row.example_meaning ?? "")
    },
    kanjiComponents: buildKanjiComponents(label),
    conjugations: row.verb_type ? [{ label: "动词类型", value: String(row.verb_type) }] : [],
    verbPair: buildVerbPair(getDatabase(), label, kana),
    confusions: confusionCandidates(row)
  };
}
