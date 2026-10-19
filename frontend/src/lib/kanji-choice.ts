/** 单字选择题只拼现有字音索引与词库；不生成或打包另一份题库。 */
import { getDatabase } from "./database";
import { rowsFor } from "./study-core";
import { allKanjiUnits, kanjiUnitExamples, kanjiUnitIndexLoaded, type KanjiUnitRecord } from "./kanji-unit-index";
import { shuffleKanjiReadingOptions } from "./kanji-reading-usage";

export interface KanjiChoiceItem {
  wordId: number;
  word: string;
  start: number;
  length: number;
  kana: string;
  meaning: string;
  answer: string;
  base: string;
  variant: string;
  options: string[];
}

export interface KanjiChoiceQuestion { items: KanjiChoiceItem[] }

const hiragana = (value: string) => value.normalize("NFKC").replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
const isHiragana = (value: string) => /^[ぁ-ゖ]+$/u.test(value);
const VOICING = ["かが", "きぎ", "くぐ", "けげ", "こご", "さざ", "しじ", "すず", "せぜ", "そぞ", "ただ", "ちぢ", "つづ", "てで", "とど", "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ"];
const CONTRACTED: Record<string, string> = { き: "かくこ", ぎ: "がぐご", し: "さすそ", じ: "ざずぞ", ち: "たつと", に: "なぬの", ひ: "はふほ", び: "ばぶぼ", ぴ: "ぱぷぽ", み: "まむも", り: "らるろ" };

/** extra 保留来源优先级，其余每次只扰动一个读音细节。 */
export const readingDistractors = (correct: string, extra: string[]): string[] => {
  const answer = hiragana(correct);
  const candidates = extra.map(hiragana);
  for (let index = 0; index < answer.length; index += 1) {
    const kana = answer[index];
    const extension = "おこごそぞとどのほぼぽもよょろうくぐすずつづぬふぶぷむゆゅるゔぉぅ".includes(kana) ? "う"
      : "えけげせぜてでねへべぺめれぇ".includes(kana) ? "い" : "";
    if (!extension) continue;
    // 长音的第二拍不再加长，避免把「こう」扰动成「こうう」。
    if (kana === "う" && index > 0 && "おこごそぞとどのほぼぽもよょろうくぐすずつづぬふぶぷむゆゅるゔぉぅ".includes(answer[index - 1])) continue;
    candidates.push(answer[index + 1] === extension
      ? answer.slice(0, index + 1) + answer.slice(index + 2)
      : answer.slice(0, index + 1) + extension + answer.slice(index + 1));
  }
  const voiced = VOICING.find((group) => group.includes(answer[0] ?? ""));
  if (answer && voiced) for (const kana of voiced) candidates.push(kana + answer.slice(1));
  for (const [stem, row] of Object.entries(CONTRACTED)) {
    for (let index = 0; index < 3; index += 1) {
      const contracted = stem + "ゃゅょ"[index];
      for (const plain of [stem, row[index]]) {
        if (answer.includes(contracted)) candidates.push(answer.replace(contracted, plain));
        // 小假名前的首拍已有拗音，不能再插一枚小假名。
        const position = answer.indexOf(plain);
        if (position >= 0 && !"ゃゅょ".includes(answer[position + 1] ?? " ")) {
          candidates.push(answer.slice(0, position) + contracted + answer.slice(position + 1));
        }
      }
    }
  }
  candidates.push(answer.endsWith("ん") ? answer.slice(0, -1) : answer + "ん");
  if (/[つく]$/u.test(answer)) candidates.push(answer.slice(0, -1) + "っ");
  if (answer.endsWith("っ")) candidates.push(answer.slice(0, -1) + "つ", answer.slice(0, -1) + "く");
  return [...new Set(candidates)].filter((value) => isHiragana(value) && value !== answer);
};

const SOUND_CHANGES = new Set(["rendaku", "sokuon", "handaku", "rendaku-handaku", "on-drop"]);
let unitsByChar: Map<string, KanjiUnitRecord[]> | null = null;
const charUnits = (char: string) => {
  if (!unitsByChar) {
    unitsByChar = new Map();
    for (const unit of allKanjiUnits()) {
      if (unit.unitType !== "char") continue;
      const units = unitsByChar.get(unit.char) ?? [];
      units.push(unit);
      unitsByChar.set(unit.char, units);
    }
  }
  return unitsByChar.get(char) ?? [];
};

// 换库时重新取题，不能把旧词库的例词或合法读音带进导入 / 同步后的库。
const questionsByDatabase = new WeakMap<object, Map<string, KanjiChoiceQuestion | null>>();
const spellingsByDatabase = new WeakMap<object, Map<string, { wordId: number; kana: string }[]>>();
const sameSpellingWords = () => {
  const db = getDatabase();
  let spellings = spellingsByDatabase.get(db);
  if (!spellings) {
    spellings = new Map();
    for (const row of rowsFor("SELECT id, kanji, kana FROM words")) {
      const word = String(row.kanji ?? "");
      const peers = spellings.get(word) ?? [];
      peers.push({ wordId: Number(row.id), kana: hiragana(String(row.kana ?? "")) });
      spellings.set(word, peers);
    }
    spellingsByDatabase.set(db, spellings);
  }
  return spellings;
};

const shuffleOptions = (options: string[], char: string, wordId: number) => {
  let seed = 2166136261;
  for (const kana of `${char}:${wordId}`) seed = Math.imul(seed ^ kana.charCodeAt(0), 16777619) >>> 0;
  return shuffleKanjiReadingOptions(options, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
};

/** 每字首次取题按当时熟悉度排序；本次数据库实例内复用题面和选项。 */
const buildChoiceQuestion = (char: string, batchWords?: Map<number, ReturnType<typeof rowsFor>[number]>): KanjiChoiceQuestion | null => {
  if (!kanjiUnitIndexLoaded()) return null;
  const db = getDatabase();
  let cache = questionsByDatabase.get(db);
  if (!cache) { cache = new Map(); questionsByDatabase.set(db, cache); }
  if (cache.has(char)) return cache.get(char)!;
  const units = charUnits(char);
  const examples = units.flatMap((unit) => kanjiUnitExamples(unit.unitKey).map((example) => ({ ...example, base: unit.base })));
  const wordIds = [...new Set(examples.map((example) => example.wordId))];
  const candidates: Omit<KanjiChoiceItem, "options">[] = [];
  if (wordIds.length) {
    const words = batchWords ? wordIds.flatMap((id) => {
      const row = batchWords.get(id);
      return row ? [row] : [];
    }).sort((a, b) => Number(b.seen) - Number(a.seen) || Number(b.importance) - Number(a.importance) || Number(a.id) - Number(b.id)) : rowsFor(`
      SELECT w.id, w.kanji, w.kana, w.meaning, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
      FROM words w LEFT JOIN progress p ON p.word_id = w.id
      WHERE w.id IN (${wordIds.map(() => "?").join(",")})
      ORDER BY seen DESC, importance DESC, w.id ASC
    `, wordIds);
    for (const row of words) {
      const word = String(row.kanji ?? "");
      if (/[\[\]]/u.test(word)) continue;
      for (const example of examples) {
        if (example.wordId !== Number(row.id) || word.slice(example.start, example.start + example.length) !== char) continue;
        if (example.variant !== "base" && !SOUND_CHANGES.has(example.variant)) continue;
        const answer = hiragana(example.reading);
        const base = hiragana(example.base);
        if (!isHiragana(answer) || !isHiragana(base)) continue;
        candidates.push({ wordId: example.wordId, word, start: example.start, length: example.length, kana: String(row.kana ?? ""), meaning: String(row.meaning ?? ""), answer, base, variant: example.variant });
      }
    }
  }
  const selected = [candidates.find((item) => item.variant === "base"), candidates.find((item) => SOUND_CHANGES.has(item.variant))];
  const items: KanjiChoiceItem[] = [];
  for (const item of selected) {
    if (!item) continue;
    const peers = sameSpellingWords().get(item.word) ?? [];
    const extras = [...(item.variant === "base" ? [] : [item.base]), ...units.map((unit) => unit.base)];
    const distractors = readingDistractors(item.answer, extras).filter((option) => !peers.some((peer) => {
      if (peer.wordId === item.wordId) return false;
      const aligned = examples.filter((example) => example.wordId === peer.wordId && example.start === item.start && example.length === item.length);
      // 索引只保留前六个例词；其它词条缺切段时，保守排掉其整词假名中出现的候选音。
      return aligned.length ? aligned.some((example) => hiragana(example.reading) === option) : peer.kana.includes(option);
    })).slice(0, 3);
    // 音变项的 base 必须是错答；同写法另一词条合法使用它时，宁可不出这一项。
    if (!distractors.length || (item.variant !== "base" && !distractors.includes(item.base))) continue;
    items.push({ ...item, options: shuffleOptions([item.answer, ...distractors], char, item.wordId) });
  }
  const question = items.length ? { items } : null;
  cache.set(char, question);
  return question;
};

export const kanjiChoiceQuestion = (char: string): KanjiChoiceQuestion | null => buildChoiceQuestion(char);

/** 同步资格扫描时按当时熟悉度一次读完；不保留词行快照，之后新取的字仍读最新进度。 */
export const warmKanjiChoiceQuestions = (chars: string[]): void => {
  if (!kanjiUnitIndexLoaded()) return;
  const cache = questionsByDatabase.get(getDatabase());
  const pending = chars.filter((char) => !cache?.has(char));
  if (!pending.length) return;
  // 小程序 iPhone 解释执行 WASM，逐字解析同一条例词查询太贵，整批共用一次读取和排序。
  const words = rowsFor(`
    SELECT w.id, w.kanji, w.kana, w.meaning, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
    ORDER BY seen DESC, importance DESC, w.id ASC
  `);
  const byId = new Map(words.map((row) => [Number(row.id), row]));
  for (const char of pending) buildChoiceQuestion(char, byId);
};
