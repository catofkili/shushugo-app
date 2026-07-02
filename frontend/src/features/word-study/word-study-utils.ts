import type {
  WordAnswer,
  WordCard,
  WordLevelFilter,
  WordTypeFilter
} from "../../types/vocabulary";

export const answerOptions: { value: WordAnswer; label: string }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊" },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知" }
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

const hasAscii = (text: string) => /[A-Za-z]/.test(text);
const hasKatakana = (text: string) => /[\u30a0-\u30ff]/.test(text);

export const isLoanwordSourceCard = (card: WordCard) => hasAscii(card.kanji) && hasKatakana(card.kana);

export const primaryAnswerText = (card: WordCard) => isLoanwordSourceCard(card) ? card.kana : card.kanji;

export const secondaryAnswerText = (card: WordCard) => isLoanwordSourceCard(card) ? card.kanji : card.kana;

export const cardLabel = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  return primary === secondary ? primary : `${primary} / ${secondary}`;
};

export const answerReadingText = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  if (!secondary || secondary === primary || hasAscii(secondary)) return "";
  return secondary;
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
