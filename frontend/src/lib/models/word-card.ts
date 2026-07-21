import type { Database } from "sql.js";
import { getDatabase } from "../database";
import { WordCard } from "../../types/vocabulary";
import { DbRow, SqlValue } from "../database/db-utils";
import { confusionCandidates } from "./confusion";
import kanjiVariantPayload from "../../data/kanji_variants.json";
import verbPairHintPayload from "../../data/verb_pair_hints.json";
import englishOriginPayload from "../../data/english_origins.json";

type VerbPairHint = readonly [voice: string, pairKanji: string, pairKana: string, note: string];

// 把数据库里的英文 verb_type 显示成课本的「一类/二类/三类」标注
const VERB_TYPE_LABELS: Record<string, string> = {
  godan: "一类动词（五段）",
  iku: "一类动词（五段）",
  ichidan: "二类动词（一段）",
  suru: "三类动词（サ变）",
  kuru: "三类动词（カ变）"
};

const verbTypeLabel = (verbType: string): string => VERB_TYPE_LABELS[verbType] ?? verbType;

const kanjiVariants = (kanjiVariantPayload as { japanese_to_simplified?: Record<string, string> })
  .japanese_to_simplified ?? {};

const verbPairHints = Object.fromEntries(
  Object.entries(verbPairHintPayload as Record<string, string[]>).flatMap(([key, value]) => {
    if (value.length < 4) return [];
    return [[key, [value[0], value[1], value[2], value[3]] as VerbPairHint]];
  })
) as Record<string, VerbPairHint>;

const englishOrigins = englishOriginPayload as Record<string, string>;
const latinPattern = /[A-Za-zＡ-Ｚａ-ｚ]+/g;
const cjkPattern = /[\u3400-\u9fff]/;

function englishOrigin(kanji: string, kana: string, meaning: string): string {
  if (!/[\u30a0-\u30ff]/.test(`${kanji}${kana}`)) return "";
  const mapped = englishOrigins[kanji] || englishOrigins[kana];
  if (mapped) return mapped;
  const nonEnglishMarker = /^\s*[（(\[]\s*(?:法|フ|仏|德|独|オ|蘭|葡|ポ|伊|イ|露|ロ)\s*[）)\]]/;
  if (/[A-Za-z]/.test(kanji)) {
    return kanji.split(/[；;]/).find((part) => /[A-Za-z]/.test(part) && !nonEnglishMarker.test(part))?.trim() ?? "";
  }
  if (nonEnglishMarker.test(meaning)) return "";
  return meaning.match(/[A-Za-z]+(?:[ .'-]+[A-Za-z]+)*/)?.[0]?.replace(/[ .;,-]+$/, "") ?? "";
}

function isUpperAcronym(text: string): boolean {
  const asciiText = text.replace(/[Ａ-Ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  return asciiText.length >= 2 && asciiText.length <= 4 && asciiText === asciiText.toUpperCase();
}

function hasUpperLatin(text: string): boolean {
  return /[A-ZＡ-Ｚ]/.test(text);
}

function stripLatinGlosses(text: string): string {
  return text.replace(latinPattern, (token, offset, source) => {
    const prev = offset > 0 ? source[offset - 1] : "";
    const next = offset + token.length < source.length ? source[offset + token.length] : "";
    if (token.length <= 4 && hasUpperLatin(token) && cjkPattern.test(`${prev}${next}`)) return token;
    if (isUpperAcronym(token)) return token;
    return "";
  });
}

// "源词注记"——「ハンカチーフ」的省略 / トイレット的缩略 / ビルディング（building）
// 的缩写 / 「携帯電話」の略 / "星期一"的省略 这类"X 是 Y 的缩写/省略/简称"的说明。
// 题目面只应留中文释义:注记要么泄漏读音/带英文,要么把答案原词写了出来,一律整段
// 删除(源词 + 括号/引用 + 的/の/之 + 缩写/省略… 尾巴)。答案面(reveal)展示完整
// card.meaning,删掉不丢信息。带 的/の/之 连接词是判定"注记"的关键——省略/中略/略す
// 这类"本身就是释义"的词没有连接词,不会被误删。
const ABBR_SRC =
  "(?:" +
  '[「『“"][^「」『』“”"]*[」』”"]' +   // 引用组「…」『…』"…"
  "|[（(［〔][^（()）［\\]〔〕]*[）)］〕]" + // 括号组（…）［…］〔…〕
  "|[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ・]+" +       // 假名源词
  "|[A-Za-zＡ-Ｚａ-ｚ]+" +               // 英文源词
  "|[·\\s]" +
  ")*";
const ABBR_TAIL = "(?:省略|縮略|缩略|简称|簡称|略称|略語|略语|缩写|縮写|略)(?:语|語|词|詞)?";
const abbreviationNotePattern = new RegExp(`${ABBR_SRC}(?:的|の|之)\\s*${ABBR_TAIL}`, "g");

function stripAbbreviationNotes(text: string): string {
  return text
    .replace(abbreviationNotePattern, "")
    .replace(/[「『]\s*[」』]/g, "")
    .replace(/([。．；;，,、])[；;，,、]+/g, "$1");
}

// 题目面展示的是中文释义,不该出现日文假名:出现的假名要么直接泄漏读音
//（「酒（详见「さけ」）」「（いっぱい）…」这类),要么是「…の形で」「…の略」等
// 用法注记。答案面(reveal)始终展示完整的 card.meaning,所以题目面删掉这些
// 带假名的括号/引用和散落假名不会丢失任何信息,却能避免直接把读音剧透。
const KANA_CHAR = /[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]/;
const KANA_RUN = /[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]+/g;

function stripKanaNotes(text: string): string {
  return text
    // 含假名的括号组整体删除:（…）()［…］〔…〕(注记里可能内嵌「」,一并吞掉)
    .replace(/[（(［〔\[][^（(）)［\]〔〕]*[）)］〕\]]/g, (m) => (KANA_CHAR.test(m) ? "" : m))
    // 含假名的独立引用组整体删除:「…」『…』"…"
    .replace(/[「『“][^「」『』“”]*[」』”]/g, (m) => (KANA_CHAR.test(m) ? "" : m))
    // 删除残留的散落假名
    .replace(KANA_RUN, "")
    // 清理删除后留下的空括号与悬挂标点
    .replace(/[（(［〔\[]\s*[）)］〕\]]/g, "")
    .replace(/[「『]\s*[」』]/g, "")
    .replace(/([；;，,、])[；;，,、]+/g, "$1")
    .replace(/^[\s；;，,、.:：/·]+/, "")
    .replace(/[；;，,、\s]+$/, "")
    .trim();
}

export function questionMeaning(meaning: string): string {
  return stripKanaNotes(stripAbbreviationNotes(stripLatinGlosses(meaning)))
    .replace(/[（(\[]\s*(?:英|美)\s*[）)\]]/g, "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\s*([；;，,])\s*/g, "$1")
    .replace(/^[\s；;，,、.:：/]+/, "")
    .replace(/[；;，,、\s]+$/, "")
    .trim();
}

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
  const key = kanji in verbPairHints ? kanji : (!kanji || kanji === kana ? kana : "");
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
  short = stripAbbreviationNotes(stripLatinGlosses(short)).trim();
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

// 敬语/谦语动词的词库释义往往只有普通体翻译（頂く→「吃，喝」，和 食べる 在题目栏
// 无法区分），按词形兜底标注。键是卡片展示用的 label（kanji 列，缺省 kana），必须
// 精确匹配：おる（居る谦语）不能误伤同音的 折る/織る。
const HONORIFIC_WORD_LABELS: Record<string, string> = {
  "いらっしゃる": "敬语",
  "おっしゃる": "敬语",
  "なさる": "敬语",
  "くださる": "敬语",
  "ご覧になる": "敬语",
  "おいでになる": "敬语",
  "お越しになる": "敬语",
  "お召しになる": "敬语",
  "召し上がる": "敬语",
  "伺う": "谦语",
  "参る": "谦语",
  "申す": "谦语",
  "申し上げる": "谦语",
  "頂く": "谦语",
  "いただく": "谦语",
  "差し上げる": "谦语",
  "致す": "谦语",
  "おる": "谦语",
  "存じる": "谦语",
  "存じ上げる": "谦语",
  "拝見": "谦语",
  "頂戴": "谦语",
  "拝借": "谦语",
  "お目にかかる": "谦语",
  "承る": "谦语",
  "かしこまりました": "谦语"
};

export function honorificLabel(meaning: string, label = ""): string {
  if (/(謙譲語|謙讓語|谦让语|谦让|謙讓)/.test(meaning)) return "谦语";
  if (/(谦称|謙称|謙稱)/.test(meaning)) return "谦称";
  if (meaning.includes("自谦")) return "自谦";
  if (/(敬语|敬語|尊敬表达|尊敬語|敬称|敬意|对外敬语)/.test(meaning)) return "敬语";
  return HONORIFIC_WORD_LABELS[label] ?? "";
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
    questionMeaning: questionMeaning(meaning),
    primaryMeaning: primaryMeaning(meaning),
    promptMeaning: promptMeaning(meaning, id, label),
    honorificLabel: honorificLabel(meaning, label),
    kana,
    kanji: label,
    englishOrigin: englishOrigin(label, kana, meaning),
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
    conjugations: row.verb_type ? [{ label: "动词类型", value: verbTypeLabel(String(row.verb_type)) }] : [],
    verbPair: buildVerbPair(getDatabase(), label, kana),
    confusions: confusionCandidates(row)
  };
}
