/** 单字选择题只拼现有字音索引与词库；不生成或打包另一份题库。 */
import { getDatabase } from "./database";
import { firstValue, rowsFor } from "./study-core";
import type { SqlValue } from "./database/db-utils";
import { allKanjiUnits, kanjiUnitExamples, kanjiUnitIndexLoaded, type KanjiUnitRecord, type KanjiUnitExample } from "./kanji-unit-index";
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
      peers.push({ wordId: Number(row.id), kana: String(row.kana ?? "") });
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

type ChoiceExample = KanjiUnitExample & { base: string };
type ChoiceWord = ReturnType<typeof rowsFor>[number];
type ChoiceCandidate = Omit<KanjiChoiceItem, "options">;

const choiceExamples = (units: KanjiUnitRecord[]): ChoiceExample[] =>
  units.flatMap((unit) => kanjiUnitExamples(unit.unitKey).map((example) => ({ ...example, base: unit.base })));

// 原先排序后取首个 base / 音变项；线性保留同一排序键的最优项，相等时保留原例词顺序。
const selectedCandidates = (char: string, examples: ChoiceExample[], words: Map<number, ChoiceWord>): ChoiceCandidate[] => {
  const selected: { row: ChoiceWord; example: ChoiceExample; answer: string; base: string }[] = [];
  for (const example of examples) {
    const row = words.get(example.wordId);
    if (!row) continue;
    const word = String(row.kanji ?? "");
    if (/[\[\]]/u.test(word) || word.slice(example.start, example.start + example.length) !== char) continue;
    if (example.variant !== "base" && !SOUND_CHANGES.has(example.variant)) continue;
    const index = example.variant === "base" ? 0 : 1;
    const previous = selected[index];
    if (previous) {
      const order = Number(previous.row.seen) - Number(row.seen)
        || Number(previous.row.importance) - Number(row.importance)
        || Number(row.id) - Number(previous.row.id);
      if (order >= 0) continue;
    }
    const answer = hiragana(example.reading);
    const base = hiragana(example.base);
    if (!isHiragana(answer) || !isHiragana(base)) continue;
    selected[index] = { row, example, answer, base };
  }
  return selected.flatMap(({ row, example, answer, base }) => [{
    wordId: example.wordId, word: String(row.kanji ?? ""), start: example.start, length: example.length,
    kana: String(row.kana ?? ""), meaning: String(row.meaning ?? ""), answer, base, variant: example.variant
  }]);
};

const acceptsDistractor = (item: ChoiceCandidate, examples: ChoiceExample[]) => {
  const peers = sameSpellingWords().get(item.word) ?? [];
  return (option: string) => !peers.some((peer) => {
    if (peer.wordId === item.wordId) return false;
    const aligned = examples.filter((example) => example.wordId === peer.wordId && example.start === item.start && example.length === item.length);
    // 索引只保留前六个例词；其它词条缺切段时，保守排掉其整词假名中出现的候选音。
    return aligned.length ? aligned.some((example) => hiragana(example.reading) === option) : hiragana(peer.kana).includes(option);
  });
};

const choiceDistractors = (item: ChoiceCandidate, units: KanjiUnitRecord[], examples: ChoiceExample[]): string[] => {
  const extras = [...(item.variant === "base" ? [] : [item.base]), ...units.map((unit) => unit.base)];
  return readingDistractors(item.answer, extras).filter(acceptsDistractor(item, examples)).slice(0, 3);
};

const canUseDistractors = (item: ChoiceCandidate, distractors: string[]): boolean =>
  distractors.length > 0 && (item.variant === "base" || distractors.includes(item.base));

/** 每字首次取题按当时熟悉度排序；本次数据库实例内复用题面和选项。 */
const buildChoiceQuestion = (char: string): KanjiChoiceQuestion | null => {
  if (!kanjiUnitIndexLoaded()) return null;
  const db = getDatabase();
  let cache = questionsByDatabase.get(db);
  if (!cache) { cache = new Map(); questionsByDatabase.set(db, cache); }
  if (cache.has(char)) return cache.get(char)!;
  const units = charUnits(char);
  const examples = choiceExamples(units);
  const wordIds = [...new Set(examples.map((example) => example.wordId))];
  const words = wordIds.length ? rowsFor(`
    SELECT w.id, w.kanji, w.kana, w.meaning, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
    WHERE w.id IN (${wordIds.map(() => "?").join(",")})
  `, wordIds) : [];
  const selected = selectedCandidates(char, examples, new Map(words.map((row) => [Number(row.id), row])));
  const items: KanjiChoiceItem[] = [];
  for (const item of selected) {
    if (!item) continue;
    const distractors = choiceDistractors(item, units, examples);
    // 音变项的 base 必须是错答；同写法另一词条合法使用它时，宁可不出这一项。
    if (!canUseDistractors(item, distractors)) continue;
    items.push({ ...item, options: shuffleOptions([item.answer, ...distractors], char, item.wordId) });
  }
  const question = items.length ? { items } : null;
  cache.set(char, question);
  return question;
};

export const kanjiChoiceQuestion = (char: string): KanjiChoiceQuestion | null => buildChoiceQuestion(char);

/** 小程序 iPhone 每次冷启动都查资格：批读最少的词列，只选候选并验干扰项，不建题面、排序或洗牌。 */
export const eligibleKanjiChoiceChars = (chars: string[]): string[] => {
  if (!kanjiUnitIndexLoaded() || !chars.length) return [];
  const db = getDatabase();
  const examplesByChar = new Map(chars.map((char) => [char, choiceExamples(charUnits(char))]));
  const wordIds = new Set([...examplesByChar.values()].flatMap((examples) => examples.map((example) => example.wordId)));
  const byId = new Map<number, ChoiceWord>();
  // 同写法的其它词才需要假名归一化；别在冷启动把一万多条不会比较的读音全算一遍。
  const spellings = new Map<string, { wordId: number; kana: string }[]>();
  const rows = JSON.parse(firstValue<string>(`
    SELECT json_group_array(json_array(w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0), COALESCE(w.importance, 0)))
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `, [], "[]")) as SqlValue[][];
  for (const [id, kanji, kana, seen, importance] of rows) {
    const wordId = Number(id);
    const word = String(kanji ?? "");
    if (wordIds.has(wordId)) byId.set(wordId, { id, kanji, kana, seen, importance });
    const peers = spellings.get(word) ?? [];
    peers.push({ wordId, kana: String(kana ?? "") });
    spellings.set(word, peers);
  }
  if (!spellingsByDatabase.has(db)) spellingsByDatabase.set(db, spellings);
  const cache = questionsByDatabase.get(getDatabase());
  return chars.filter((char) => {
    if (cache?.has(char)) return cache.get(char) !== null;
    const units = charUnits(char);
    const examples = examplesByChar.get(char)!;
    return selectedCandidates(char, examples, byId).some((item) => {
      const allowed = acceptsDistractor(item, examples);
      // 音变的 base 是第一候选，合法且未被同写词排除就必在前三；相同则永远被正确答案过滤。
      if (item.variant !== "base") return item.base !== item.answer && allowed(item.base);
      // 增删末尾「ん」是生成器必给的合法干扰项；资格只问存在性，不需要先生成其它音变。
      const nasal = item.answer.endsWith("ん") ? item.answer.slice(0, -1) : item.answer + "ん";
      if (nasal && allowed(nasal)) return true;
      return canUseDistractors(item, choiceDistractors(item, units, examples));
    });
  });
};
