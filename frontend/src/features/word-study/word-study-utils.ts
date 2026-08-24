import type {
  WordAnswer,
  WordCard,
  WordLevelFilter,
  WordTypeFilter
} from "../../types/vocabulary";
import type { FuriganaSegment } from "../../lib/furigana";
import {
  cleanWordSurface,
  isLoanwordSourceSurface,
  orthographyEntry,
  preferredWordSurface
} from "../../lib/orthography";

/**
 * 四个评分键。`secondary` 的两个(模糊 / 熟知)在卡面上摆一半宽、去掉填色。
 *
 * 宽度就是那句「这两个不是每张卡都要用」——Anki 官方的频率指引是
 * Good 占 80-95%、Again 占 5-20%,Hard 和 Easy 加起来只剩个位数;
 * 而实测用户的模糊占到 25-30%,正是四个等宽格子请出来的。
 * 说明书只在第一次有用,分量要靠尺寸说,那个每张卡都在说。
 */
export const answerOptions: { value: WordAnswer; label: string; secondary?: boolean }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊", secondary: true },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知", secondary: true }
];

export const levelOptions: { value: WordLevelFilter; label: string }[] = [
  { value: "All", label: "全部" },
  { value: "N5", label: "N5" },
  { value: "N4", label: "N4" },
  { value: "N3", label: "N3" },
  { value: "N2", label: "N2" },
  { value: "N1", label: "N1" },
  { value: "Unleveled", label: "未分级" }
];

export const typeOptions: { value: WordTypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "noun", label: "名词" },
  { value: "verb", label: "动词" },
  { value: "adjective", label: "形容词" },
  { value: "adverb", label: "副词" },
  { value: "favorite", label: "收藏" }
];

export const isLoanwordSourceCard = (card: WordCard) => isLoanwordSourceSurface(card);

export const primaryAnswerText = (card: WordCard) => preferredWordSurface(card);

export const secondaryAnswerText = (card: WordCard) => {
  if (isLoanwordSourceSurface(card)) return card.kanji;
  const entry = orthographyEntry(card);
  // 假名优先词仍把原汉字作为小字资料保留，不再把它当主表记教。
  if (entry?.band === "kana" || entry?.band === "low") return cleanWordSurface(card.kanji);
  return card.kana;
};

export const cardLabel = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  return primary === secondary ? primary : `${primary} / ${secondary}`;
};

export const answerReadingText = (card: WordCard, surface = primaryAnswerText(card)) => {
  if (!surface || !/[\u3400-\u9fff]/u.test(surface)) return "";
  return card.kana;
};

export interface ConcealedReadingPart {
  /** 空字符串表示这段读音必须保持隐藏，不能留在 DOM 里泄题。 */
  text: string;
  hidden: boolean;
}

/**
 * 汉字读音模式的题面：只露出表记里本来就是假名的部分，汉字对应的读音用遮罩代替。
 *
 * 对齐失败或读音表尚未加载时必须 fail closed，整条读音隐藏。绝不能先把完整假名
 * 当 fallback 画出来，再异步换成遮罩——那会在每张卡首帧闪答案。
 */
export const concealedReadingParts = (
  segments: readonly FuriganaSegment[] | null
): ConcealedReadingPart[] => {
  if (!segments?.length) return [{ text: "", hidden: true }];
  return segments.map((segment) => segment.isKanji
    ? { text: "", hidden: true }
    // 非汉字段显示表记本身：生産コスト应保留「コスト」，不能退成读音串里的「こすと」。
    : { text: segment.text, hidden: false });
};

const kanaMap: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo",
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
  ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
  ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
  ワ: "wa", ヲ: "wo", ン: "n",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po"
};

const yoonMap: Record<string, string> = {
  kya: "kya", kiya: "kya", kyu: "kyu", kiyu: "kyu", kyo: "kyo", kiyo: "kyo",
  sha: "sha", shiya: "sha", shu: "shu", shiyu: "shu", sho: "sho", shiyo: "sho",
  cha: "cha", chiya: "cha", chu: "chu", chiyu: "chu", cho: "cho", chiyo: "cho",
  nya: "nya", niya: "nya", nyu: "nyu", niyu: "nyu", nyo: "nyo", niyo: "nyo",
  hya: "hya", hiya: "hya", hyu: "hyu", hiyu: "hyu", hyo: "hyo", hiyo: "hyo",
  mya: "mya", miya: "mya", myu: "myu", miyu: "myu", myo: "myo", miyo: "myo",
  rya: "rya", riya: "rya", ryu: "ryu", riyu: "ryu", ryo: "ryo", riyo: "ryo",
  gya: "gya", giya: "gya", gyu: "gyu", giyu: "gyu", gyo: "gyo", giyo: "gyo",
  ja: "ja", jiya: "ja", ju: "ju", jiyu: "ju", jo: "jo", jiyo: "jo",
  bya: "bya", biya: "bya", byu: "byu", biyu: "byu", byo: "byo", biyo: "byo",
  pya: "pya", piya: "pya", pyu: "pyu", piyu: "pyu", pyo: "pyo", piyo: "pyo"
};

export const kanaToRomaji = (text: string) => {
  const parts: string[] = [];
  let doubleNext = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "っ" || char === "ッ") {
      doubleNext = true;
      continue;
    }
    if (char === "ー") {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""}-`;
      continue;
    }
    const base = kanaMap[char];
    const next = kanaMap[text[index + 1]];
    let roman = base ?? char;
    if (next && ["ゃ", "ゅ", "ょ", "ャ", "ュ", "ョ"].includes(text[index + 1])) {
      roman = yoonMap[`${roman}${next}`] ?? roman;
      index += 1;
    }
    if (doubleNext && /^[bcdfghjklmnpqrstvwxyz]/.test(roman)) roman = `${roman[0]}${roman}`;
    doubleNext = false;
    parts.push(roman);
  }
  return parts.join(" ");
};

/**
 * 读音有几拍。**这是给正向题(中文 → 日文)消歧用的,不是给记不住的词发拐杖。**
 *
 * 题面那行中文常常不止一个词对得上:实测用户库 11,056 个词里 3,935 个(35.6%)
 * 和别的词共用同一行题面(口径见 models/question-meaning-index.ts)。看到「警察」
 * 该答 警察 还是 警察官?看到「生活」该答 生活 还是 暮らす?答不出来不是忘了,
 * 是不知道在问哪个 —— 那次「忘记」喂给 FSRS 才是假数据。
 * 补一个拍数,撞车组里 47.1% 的词当场变唯一,平均候选 2.74 → 1.68。
 *
 * 剩下那一半(準備 / 用意 / 備え 全是 3 拍)拍数分不开,交给题面撞车那一档去说。
 *
 * 口径:拗音(小 ゃゅょ、外来語的小 ァィゥェォ)并进前一拍;促音 っ、拨音 ん、
 * 长音 ー 各算一拍 —— 这是日语的「拍」,不是音节,カード 是 3 拍不是 2 音节。
 * **只能拿 kana 算**:外来語行的 kanji 存的是词源(camera / gramme)。
 */
const NON_MORA_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/;

export const moraCount = (kana: string): number => {
  // 用户库里 kana 干净(没有方括号注音、空格、拉丁字母),只有 115 条带 ～ 或括号
  // (「～する」这类),那些不是读音的一部分。
  let count = 0;
  for (const char of kana.replace(/[～〜（）()\s・]/g, "")) {
    if (!NON_MORA_KANA.test(char)) count += 1;
  }
  return count;
};

export const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}小时${restMinutes.toString().padStart(2, "0")}分`;
  }
  if (minutes > 0) return `${minutes}分${remainder.toString().padStart(2, "0")}秒`;
  return `${remainder}秒`;
};

export const monthDays = (studyDate: string) => {
  const base = studyDate ? new Date(`${studyDate}T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = Array.from({ length: firstDay.getDay() }, () => null);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return {
      day,
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    };
  });
  return {
    title: `${year}年${month + 1}月`,
    cells: [...prefix, ...days]
  };
};
