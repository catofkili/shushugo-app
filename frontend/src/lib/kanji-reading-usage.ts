/**
 * 一字多音:一个汉字的几个读音各自什么时候用。
 *
 * 数据是构建期产物(`scripts/build-kanji-reading-usage.mjs`),懒加载单独成 chunk ——
 * 约 190 KB 静态进主包是 grammar.ts 那 1.5 MB 的前车之鉴。
 *
 * ── 和「疑难辨析」的分界,别混 ──
 * `confusion-groups` 的 reading-sense / reading-register 说的是**词**:
 * 月(つき) 和 月(げつ) 是词库里两个独立词条,同形不同读。
 * 这里说的是**字**:月 在 一月 / 月曜日 / 三日月 里读三个音,而 がつ 根本不是一个词。
 * 两者不重叠,也不该互相搬运 —— 那就是 CLAUDE.md 里警告的「第四套口径」。
 */

/** 判据代码,顺序与生成脚本的 CLAUSES 一一对应 */
export type UsageClause = "num" | "oku" | "list" | "on" | "kun";

export interface KanjiReadingExample {
  surface: string;
  kana: string;
  /**
   * 词库里这个词的释义(截到两个义项)。
   * 「读哪个音」靠送假名,「是哪个意思」只能靠它 —— 冷える(变冷) / 冷ます(晾凉)
   * 的区别送假名说不出来,而这一列本来就在 words 表里,一个字都不用人写。
   */
  meaning: string;
}

export interface KanjiReadingUsage {
  /** 读音本身(平假名) */
  base: string;
  kinds: ("on" | "kun")[];
  /** 人工说明时为 null —— 那类本来就是自动判据说不清才交给人的 */
  clause: UsageClause | null;
  /** clause 的参数(送假名形态);人工说明时是说明正文 */
  arg: string;
  /** 出现在多少个词里 */
  count: number;
  examples: KanjiReadingExample[];
  /** 这一行的说明由人写死 */
  manual: boolean;
}

export interface KanjiCharUsage {
  char: string;
  /** 0=N5 … 4=N1,5=无级 */
  levelRank: number;
  /** 整字层面的补充说明,多数字为空 */
  summary: string;
  readings: KanjiReadingUsage[];
  /** 至少一个读音是人写的 —— 也就是自动判据说不清的那批 */
  hasManual: boolean;
  /**
   * 有比音训通则更具体的判据(跟数字 / 送假名 / 封闭词表 / 人工)。
   * 纯通则的字有两百多个,说的是同一句话,界面上不该一张张摊开占地方。
   */
  hasSpecific: boolean;
}

type ReadingTuple = [string, number, number, string, number, string[]];
type CharTuple = [string, number, string, ReadingTuple[]];
interface Payload {
  version: string;
  clauses: UsageClause[];
  levels: string[];
  chars: CharTuple[];
}

interface Loaded {
  version: string;
  levels: string[];
  chars: KanjiCharUsage[];
  byChar: Map<string, KanjiCharUsage>;
}

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;

const SPECIFIC = new Set<UsageClause>(["num", "oku", "list"]);

export const decodeUsagePayload = (payload: Payload): Loaded => {
  const chars = payload.chars.map(([char, levelRank, summary, readings]) => {
    const decoded = readings.map<KanjiReadingUsage>(([base, kindBits, clauseIndex, arg, count, examples]) => {
      const kinds: ("on" | "kun")[] = [];
      if (kindBits & 1) kinds.push("on");
      if (kindBits & 2) kinds.push("kun");
      return {
        base,
        kinds,
        clause: clauseIndex >= 0 ? payload.clauses[clauseIndex] ?? null : null,
        arg,
        count,
        manual: clauseIndex < 0,
        examples: examples.map((raw) => {
          const [surface, kana, meaning] = raw.split("|");
          return { surface: surface ?? "", kana: kana ?? "", meaning: meaning ?? "" };
        })
      };
    });
    return {
      char,
      levelRank,
      summary,
      readings: decoded,
      hasManual: decoded.some((r) => r.manual),
      hasSpecific: decoded.some((r) => r.manual || (r.clause !== null && SPECIFIC.has(r.clause)))
    };
  });
  return {
    version: payload.version,
    levels: payload.levels,
    chars,
    byChar: new Map(chars.map((entry) => [entry.char, entry]))
  };
};

export const loadKanjiReadingUsage = (): Promise<void> => {
  if (loaded) return Promise.resolve();
  loading ??= import("../data/kanji_reading_usage.json").then((module) => {
    loaded = decodeUsagePayload((module.default ?? module) as unknown as Payload);
  });
  return loading;
};

export const kanjiReadingUsageLoaded = (): boolean => loaded !== null;
export const kanjiReadingUsageVersion = (): string => loaded?.version ?? "";
export const allKanjiReadingUsage = (): readonly KanjiCharUsage[] => loaded?.chars ?? [];
export const kanjiReadingUsageFor = (char: string): KanjiCharUsage | null => loaded?.byChar.get(char) ?? null;

/**
 * 判据渲染成中文。
 *
 * 送假名那条的形态由构建期挑好:同一个字上还有别的送假名读音时列到两个
 * (冷: ひ→える／やす、さ→ます／める),没有兄弟要分时只列最常见的一个。
 * 两个读音共用同一个形态(止める = とめる / やめる)时构建期根本不发这条判据,
 * 整个字转人工 —— 那种情况下送假名分不开,写出来是骗人。
 */
export const clauseText = (reading: KanjiReadingUsage): string => {
  if (reading.manual) return reading.arg;
  switch (reading.clause) {
    case "num":
      return "跟在数字后面";
    case "oku": {
      const forms = reading.arg.split("／").filter(Boolean);
      return forms.length ? `带送假名 ${forms.map((form) => `〜${form}`).join("／")}` : "带送假名";
    }
    case "list":
      return "在当前词库主要见于下面这些词";
    case "on":
      return "音读 —— 汉语复合词里";
    case "kun":
      return "训读 —— 单独用、带送假名，或和语词里";
    default:
      return "";
  }
};

/** 卡片副标题:几个读音并排,这才是这个字的辨识点 */
export const readingLine = (entry: KanjiCharUsage): string =>
  entry.readings.map((reading) => reading.base).join(" / ");
