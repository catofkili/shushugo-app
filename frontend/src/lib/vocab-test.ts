import { ensureUserTables, firstValue, persistSoon, rowsFor, setState, getState, type DbRow } from "./study-core";
import { getDatabase } from "./database";
import { classifyPos, type PosBucket } from "./word-library";
import { confusionGroupsForWord } from "./confusion-groups";
import { questionMeaningKeyOf } from "./models/question-meaning-index";
import { isLoanwordSourceSurface, kanjiReadingSurface, preferredWordSurface, shouldStudyKanjiReading } from "./orthography";
import { moraCount } from "../features/word-study/word-study-utils";

/**
 * 词汇量测验是测量，不是学习模式：它不读写 progress、reviews、FSRS 或今日计划。
 * 题面和作答快照只放在 app_state，离开页面或切 App 后可以继续当前一场。
 */
export type VocabTestQuestionKind = "reading" | "meaning";
export type VocabTestAnswerState = "correct" | "wrong" | "unknown" | "timeout";

export interface VocabTestQuestion {
  id: number;
  level: string;
  kind: VocabTestQuestionKind;
  prompt: string;
  /** 读音题拆掉送假名时，这里是被问的那几个汉字（培う → 培）。整词读音题为空。 */
  readingScope?: string;
  options: string[];
  answerIndex: number;
  answer: string;
}

export interface VocabTestResponse {
  questionIndex: number;
  questionId: number;
  answerState: VocabTestAnswerState;
  selectedOption: number | null;
  responseMs: number | null;
  answeredAt: number;
}

export interface VocabTestSession {
  version: 1;
  runId: string;
  startedAt: number;
  finishedAt: number | null;
  currentIndex: number;
  /** 已经出好的题。摸底阶段只有 20 道，答完之后按实测水平补齐到 plannedTotal。 */
  questions: VocabTestQuestion[];
  responses: VocabTestResponse[];
  populationByLevel: Record<string, number>;
  /** 这一场原本打算出几题（进度条的分母；补题前后都是它） */
  plannedTotal: number;
}

export interface VocabTestLevelResult {
  level: string;
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  unknown: number;
  timeout: number;
  rate: number | null;
}

export interface VocabTestResult {
  estimated: number;
  lower: number;
  upper: number;
  population: number;
  answered: number;
  totalQuestions: number;
  confidence: number;
  /** 「不会但还是猜了」的比例。0 = 不会就点不认识，1 = 从不用不认识 */
  gamma: number;
  /** 蒙的作答占全部作答的比例 = (4/3)·W/n。可信度按它折扣 */
  guessedShare: number;
  timeoutShare: number;
  recommendation: string;
  levels: VocabTestLevelResult[];
}

const SESSION_KEY = "vocab_test_session_v1";
export const VOCAB_TEST_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export const VOCAB_TEST_QUESTION_COUNT = 60;

/**
 * 每题的秒数按题型分：读音题要在四个假名串里逐拍比对，天然比读中文释义慢。
 * 超时记 0 分，和「不认识」同分但**分开记录** —— 可信度对两者的用法是相反的
 * （大量「不认识」= 在认真作答；大量超时 = 走神或赶进度），见 getVocabTestResult。
 */
export const VOCAB_TEST_SECONDS: Record<VocabTestQuestionKind, number> = { reading: 15, meaning: 10 };
export const secondsForQuestion = (question: Pick<VocabTestQuestion, "kind">): number =>
  VOCAB_TEST_SECONDS[question.kind] ?? VOCAB_TEST_SECONDS.reading;

/**
 * ⚠️ 一题 1 个正确 + **3** 个干扰，加「不认识」共五个按钮。
 *
 * 这个数和 levelResult 的 `wrong / 3` 是**同一个常数的两面**（惩罚 = 1/(实义选项数−1)），
 * 改一个必须改另一个。曾经出过 4 个干扰配 `/3` 的版本：纯猜的人期望得分变成 −0.067
 * 而不是 0，无偏性没了，中间水平的人被系统性压低，而 clamp(0,1) 把负数截掉、看不出来。
 */
const DISTRACTOR_COUNT = 3;

export type VocabTestWordRow = {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  level: string;
  /** 干扰项要同词性，词性字段脏（48 种写法），统一交给 word-library 的 classifyPos 收敛 */
  pos?: string;
};

const asText = (value: unknown): string => String(value ?? "").trim();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Fisher–Yates。注入随机源后，题库和测试都能稳定复现。 */
export const shuffle = <T,>(items: readonly T[], random: () => number = Math.random): T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const target = Math.floor(clamp(random(), 0, 0.999999999) * (index + 1));
    [out[index], out[target]] = [out[target], out[index]];
  }
  return out;
};

const KANA_RUN = "[\\u3040-\\u309F\\u30A0-\\u30FF\\u30FC]+";
const LEADING_KANA = new RegExp(`^${KANA_RUN}`);
const TRAILING_KANA = new RegExp(`${KANA_RUN}$`);

/**
 * ⚠️ **送假名明摆在题面上，就不能再让它出现在选项里。**
 *
 * `培う` 的四个选项曾经是 つちかう / つきあたる / つかう / さいばい —— 题面末尾那个
 * 「う」等于告诉所有人「不以 う 结尾的都是错的」，一眼排掉两个，剩下二选一靠蒙。
 * 用户原话：「有个 u 不是告诉别人这题 2 和 4 肯定是错的吗」。
 *
 * 所以读音题只问**汉字那几拍**：题面还是 培う，答案变成 つちか。这和汉字读音模式
 * 「只遮住汉字对应的那几拍假名」是同一个口径。
 *
 * 只拆得动**前后缀**（お金 → 金/かね、培う → 培/つちか、食べる → 食/た）；
 * 汉字中间夹假名的（打ち合わせ）拆完是好几段，问「这几段合起来读什么」反而更怪，
 * 那类返回 null，照旧问整词读音。
 */
export const kanjiCoreReading = (surface: string, kana: string): { core: string; reading: string } | null => {
  let core = surface.trim();
  let reading = kana.trim();
  if (!core || !reading) return null;
  const head = core.match(LEADING_KANA)?.[0] ?? "";
  if (head) {
    if (!reading.startsWith(head)) return null;
    core = core.slice(head.length);
    reading = reading.slice(head.length);
  }
  const tail = core.match(TRAILING_KANA)?.[0] ?? "";
  if (tail) {
    if (!reading.endsWith(tail)) return null;
    core = core.slice(0, -tail.length);
    reading = reading.slice(0, -tail.length);
  }
  if (!core || !reading) return null;
  // 汉字中间还夹着假名 → 不是「一段汉字」，交给整词读音
  if (new RegExp(KANA_RUN).test(core)) return null;
  if (core === surface.trim()) return null; // 本来就没有送假名
  return { core, reading };
};

/** 干扰项的三条硬约束（见 docs/VOCAB_TEST_BUILD.md §2.2）在这里算一次，别在循环里重算。 */
type WordRow = VocabTestWordRow & {
  posBucket: PosBucket;
  morae: number;
  loan: boolean;
  /** 读音题的题面（正字法口径），以及它拆出来的汉字部分 */
  readingSurface: string;
  core: { core: string; reading: string } | null;
  /** 读音题里这一行当选项时用的值：有送假名就只给汉字那几拍 */
  readingValue: string;
};

const enrichRow = (row: VocabTestWordRow): WordRow => {
  const readingSurface = kanjiReadingSurface(row);
  const core = kanjiCoreReading(readingSurface, row.kana);
  const readingValue = (core?.reading ?? row.kana).trim();
  return {
    ...row,
    posBucket: classifyPos(row.pos ?? ""),
    // 拍数是给读音题挑「长得像」的干扰项用的，所以要按**选项实际显示的那串**算
    morae: moraCount(readingValue),
    loan: isLoanwordSourceSurface({ kanji: row.kanji, kana: row.kana }),
    readingSurface,
    core,
    readingValue
  };
};

const wordRows = (): VocabTestWordRow[] => rowsFor(`
  SELECT id, kanji, kana, meaning, pos, jlpt_level AS level
  FROM words
  WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')
    AND TRIM(COALESCE(meaning, '')) <> ''
    AND TRIM(COALESCE(kana, '')) <> ''
`).map((row: DbRow) => ({
  id: Number(row.id ?? 0),
  kanji: asText(row.kanji),
  kana: asText(row.kana),
  meaning: asText(row.meaning),
  pos: asText(row.pos),
  level: asText(row.level)
})).filter((row) => row.id > 0 && VOCAB_TEST_LEVELS.includes(row.level as typeof VOCAB_TEST_LEVELS[number]));

/**
 * ⚠️ 出不出读音题、题面写什么，**都走 `orthography` 那份口径，不自己判**。
 *
 * 自己判过一版：`kanji` 原样当题面 → 方括号注音直接印在题上（库里 176 条），
 * `適[かな]う` 的答案 かなう 就写在题面里。`kanjiReadingSurface` 会摘掉注音、
 * 把 `alternate` 档换成标准表记；`shouldStudyKanjiReading` 会挡掉强假名词和外来語。
 * CLAUDE.md 那条「卡面词形全应用只有一份口径」说的就是这个，别再写第五套。
 */
const KANA_ANYWHERE = new RegExp(KANA_RUN);

/** 汉字那几拍至少要占整词读音的一半，且不少于两拍。 */
const READING_MIN_CORE_MORAE = 2;

/**
 * ⚠️ **一道读音题只有在「看不见的那部分就是难点」时才成立。**
 *
 * 三种一眼就能蒙对的题，都是这条判据挡下来的（全是用户实测报上来的）：
 *
 * | 题面 | 曾经的选项 | 为什么白送 |
 * |---|---|---|
 * | 培う | つちかう / つきあたる / つかう / さいばい | 题面那个 `う` 排掉两个（已改成只问汉字那几拍 → つちか） |
 * | 手が離せない | てにつかない / てがはなせない / てがはなれる / あいてをする | 题面上 手・が・せない 全露着，不认识「離」也选得对 |
 * | 手にかける | てをかえる / てにかける / てをかける / てをあげる | 那个 `に` 一出来，三个 `を` 全废 |
 *
 * 判据（纯粹从数据算，不用人工名单）：
 *  - **纯汉字词**（自然、経済）→ 出，整词读音就是隐藏部分；
 *  - **一段汉字 + 送假名**（培う、お金）→ 汉字那几拍 ≥ 2 拍**且** ≥ 整词的一半才出。
 *    手にかける 的汉字部分只有 て（1/6 拍），考的是「手读て」不是这个词；
 *  - **汉字中间夹假名 / 带助词的词组**（手が離せない、引き起こす）→ 不出。
 *
 * 挡下来的词**不是丢掉**，它们照旧出**中文释义题** —— 释义题的选项是中文，
 * 题面上的假名给不了任何线索，正是这类词该用的问法。
 */
const isReadingQuestion = (row: WordRow): boolean => {
  if (!shouldStudyKanjiReading(row)) return false;
  if (row.core) {
    const coreMorae = moraCount(row.core.reading);
    return coreMorae >= READING_MIN_CORE_MORAE && coreMorae * 2 >= moraCount(row.kana);
  }
  return !KANA_ANYWHERE.test(row.readingSurface);
};

const promptFor = (row: WordRow, kind: VocabTestQuestionKind): string =>
  kind === "reading" ? kanjiReadingSurface(row) : preferredWordSurface(row);

/**
 * ⚠️ 题面 → 该题面下**所有合法答案**。凡是落在这个集合里的，绝不能当干扰项。
 *
 * 上线时踩到：`側|そば`（旁边；附近）出题，题面是 そば（側 在正字表里是「常写假名」档），
 * 而库里还有 `蕎麦|そば`（荞麦面）—— **「荞麦面」被当成干扰项摆了上去，
 * 可它就是 そば 的正确答案**，用户选它被判错。
 *
 * 同一个坑在读音题那边是 `生物`（せいぶつ / なまもの）：同一个汉字表记两个读音，
 * 拿其中一个当另一个的干扰项，等于给了两个正确答案。
 *
 * 索引按**两种表记函数都算一遍**：一个词可能以汉字面出读音题、以假名面出释义题。
 */
const answerIndexBySurface = (rows: WordRow[]): {
  readings: Map<string, Set<string>>;
  meanings: Map<string, Set<string>>;
} => {
  const readings = new Map<string, Set<string>>();
  const meanings = new Map<string, Set<string>>();
  const push = (map: Map<string, Set<string>>, key: string, value: string) => {
    if (!key || !value) return;
    const bucket = map.get(key) ?? new Set<string>();
    bucket.add(value);
    map.set(key, bucket);
  };
  rows.forEach((row) => {
    [preferredWordSurface(row), row.readingSurface].forEach((surface) => {
      // 整词读音和汉字那几拍**都算这个题面的正确答案**：无论出的是哪种问法，
      // 另一种都不能被别的词拿去当干扰项。
      push(readings, surface, row.kana.trim());
      push(readings, surface, row.readingValue);
      push(meanings, surface, row.meaning.trim());
    });
  });
  return { readings, meanings };
};

type AnswerIndex = ReturnType<typeof answerIndexBySurface>;

/** 目标词在 confusion-groups 里的同组词 —— 最强的干扰项，排在候选池最前面。 */
const confusionPeerIds = (wordId: number): Set<number> => {
  try {
    const out = new Set<number>();
    confusionGroupsForWord(wordId).forEach((group) => {
      group.members.forEach((member) => { if (member.id !== wordId) out.add(member.id); });
    });
    return out;
  } catch {
    // 老库缺表、测试用的裸库都会走到这里。没有易混词只是少一层偏好，
    // 不该让整场测验出不来题 —— 下面四档硬约束已经够用。
    return new Set();
  }
};

const meaningKeyOf = (wordId: number): string | undefined => {
  try { return questionMeaningKeyOf(wordId); } catch { return undefined; }
};

const optionValue = (row: WordRow, kind: VocabTestQuestionKind): string =>
  (kind === "reading" ? row.readingValue : row.meaning).trim();

/**
 * ⚠️ 读音题：干扰项不能是答案的一部分，反过来也不行。
 *
 * 上线时踩到 `お金`：选项里摆了 **かね** —— 它是题面里唯一那个汉字「金」的正确读音，
 * 而 お 就明摆在题面上。用户选 かね 被判错，但他其实读对了这个字。
 * 同类还有 `大学` 摆 がく、`写真家` 摆 しゃしん：**答案的真子串等于"答对了一半"**，
 * 判它错是在惩罚部分知识，而部分知识本来就该算会（Nation 的规格）。
 */
const nestedReading = (answer: string, option: string): boolean =>
  answer.includes(option) || option.includes(answer);

const SMALL_KANA = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/;

/** 拆成拍：拗音并进前一拍，`っ ん ー` 各自一拍（口径同 word-study-utils.moraCount）。 */
const moraSplit = (kana: string): string[] => {
  const out: string[] = [];
  for (const char of kana.replace(/[～〜（）()\s・]/g, "")) {
    if (SMALL_KANA.test(char) && out.length) out[out.length - 1] += char;
    else out.push(char);
  }
  return out;
};

const sharesKanji = (a: string, b: string): boolean =>
  Boolean(a && b) && [...a].some((char) => /[\u4E00-\u9FFF]/.test(char) && b.includes(char));

/**
 * ⚠️ 干扰项要挑**近**的，不是随机取。
 *
 * 随机取的后果实测过：失礼（しつれい，漢語サ変名詞）抽到的干扰项是
 * よみかえす／おいかえす／めざめる（和語動詞）／どれぐらい（副詞）——
 * **知道「失礼」是个漢語名词就能全排除**，根本不用认识这个词。题目白出，词汇量偏高。
 *
 * 从严到松逐档放宽，凑够三个就停：
 * 同级 + 同词性 + 同表记类型 + 拍数差 ≤1 → 去掉同级 → 去掉同词性 → 去掉拍数 → 兜底。
 *
 * 只有读音题卡拍数（释义题的选项是中文，拍数没有意义）；
 * 只有释义题查语义撞车（`questionMeaningKeyOf` 相同就是第二个正确答案）。
 */
const distractorTiers = (
  target: WordRow,
  allRows: WordRow[],
  kind: VocabTestQuestionKind,
  index: AnswerIndex
): WordRow[][] => {
  const answer = optionValue(target, kind);
  const key = kind === "meaning" ? meaningKeyOf(target.id) : undefined;
  const prompt = promptFor(target, kind);
  // 这个题面下的全部合法答案（含同音异义、同形异读、老库重复词条）
  const alsoCorrect = (kind === "reading" ? index.readings : index.meanings).get(prompt) ?? new Set<string>();
  const base = allRows.filter((row) => {
    if (row.id === target.id) return false;
    const value = optionValue(row, kind);
    if (!value || value === answer) return false;
    if (alsoCorrect.has(value)) return false;
    if (kind === "reading" && nestedReading(answer, value)) return false;
    if (key && meaningKeyOf(row.id) === key) return false;
    return true;
  });
  const moraOk = (row: WordRow) => kind !== "reading" || Math.abs(row.morae - target.morae) <= 1;
  const samePos = (row: WordRow) => row.posBucket === target.posBucket;
  const sameKind = (row: WordRow) => row.loan === target.loan;
  return [
    base.filter((row) => row.level === target.level && samePos(row) && sameKind(row) && moraOk(row)),
    base.filter((row) => samePos(row) && sameKind(row) && moraOk(row)),
    base.filter((row) => sameKind(row) && moraOk(row)),
    base.filter(sameKind),
    base
  ];
};

/**
 * ⚠️ 读音题的干扰项必须**和正确答案共享读音成分**，否则「认识一个汉字」就够答对了。
 *
 * 上线时实测：**85.7% 的读音题里只有正确答案是那个首拍**（92.1% 的题首拍或尾拍唯一）。
 * 経済(けいざい) 的四个选项只有一个以 けい 开头 —— 知道 経 读 けい 就能选对，
 * 根本不用认识「経済」这个词。用户的 N2 正确率被这条抬到 57%，词汇量整体高估一倍。
 *
 * 修法是给三个干扰项分「音位槽」：一个共享词头、一个共享词尾、一个共享汉字或前两者之一。
 * 共享的拍数优先取一半（4 拍词就要共享 2 拍），供给不够再退到 1 拍。
 */
const readingSlots = (
  target: WordRow,
  answer: string,
  pool: WordRow[]
): ((row: WordRow) => boolean)[] => {
  const morae = moraSplit(answer);
  const half = Math.max(1, Math.ceil(morae.length / 2));
  const prefix = (n: number) => morae.slice(0, n).join("");
  const suffix = (n: number) => morae.slice(-n).join("");
  const startsWith = (n: number) => (row: WordRow) => row.readingValue !== answer && row.readingValue.startsWith(prefix(n));
  const endsWith = (n: number) => (row: WordRow) => row.readingValue !== answer && row.readingValue.endsWith(suffix(n));
  const supplied = (test: (row: WordRow) => boolean) => pool.some(test);
  // 长的共享段更狠，但供给可能不够，逐级退到 1 拍
  const head = supplied(startsWith(half)) ? startsWith(half) : startsWith(1);
  const tail = supplied(endsWith(half)) ? endsWith(half) : endsWith(1);
  return [
    head,
    tail,
    (row: WordRow) => sharesKanji(target.kanji, row.kanji) || head(row) || tail(row)
  ];
};

const makeQuestion = (
  row: WordRow,
  allRows: WordRow[],
  random: () => number,
  index: AnswerIndex
): VocabTestQuestion | null => {
  const kind: VocabTestQuestionKind = isReadingQuestion(row) ? "reading" : "meaning";
  const answer = optionValue(row, kind);
  if (!answer) return null;
  const peers = confusionPeerIds(row.id);
  const chosen: string[] = [];
  const seen = new Set<string>([answer]);
  const tiers = distractorTiers(row, allRows, kind, index);

  const alsoCorrect = (kind === "reading" ? index.readings : index.meanings).get(promptFor(row, kind)) ?? new Set<string>();
  /**
   * ⚠️ 题面有歧义（`そば` 底下挂着 蕎麦 和 側）**不是**不出题的理由。
   *
   * 判据只有一条：**屏幕上只能有一个正确答案**。把同题面的其它合法答案全部
   * 挡在选项之外就够了 —— 只知道「そば = 荞麦面」的用户看到的四个选项里没有它，
   * 他会点「不认识」，那记录的就是「他不知道 そば 的这个义项」，本来就是实话，不是误判。
   *
   * 曾经在这里加过 `if (alsoCorrect.size > 1) return null`（整道题不出）。
   * 那多挡掉 187 条（1.7%），而 **N5 被挡掉 85/912（9.3%）** —— 单汉字词都堆在那一级，
   * 偏偏 N5 池子最小、每场还要抽 10 题。为一个不存在的误判去啃最紧的那一级，不划算。
   */
  alsoCorrect.forEach((value) => seen.add(value));

  if (kind === "reading") {
    // 槽位在**放宽后的池子**上找：音位约束比同词性/同级更重要，
    // 供给不够时宁可换个词性，也不要给出一个靠首拍就能排除的选项。
    const pool = tiers[2].length >= 12 ? tiers[2] : tiers[4];
    const preferred = (a: WordRow, b: WordRow) =>
      Number(sharesKanji(row.kanji, b.kanji)) - Number(sharesKanji(row.kanji, a.kanji))
      || Number(b.posBucket === row.posBucket) - Number(a.posBucket === row.posBucket);
    readingSlots(row, answer, pool).forEach((slot) => {
      if (chosen.length >= DISTRACTOR_COUNT) return;
      const candidate = shuffle(pool.filter(slot), random).sort(preferred)
        .find((item) => !seen.has(item.readingValue) && !nestedReading(answer, item.readingValue));
      if (!candidate) return;
      seen.add(candidate.readingValue);
      chosen.push(candidate.readingValue);
    });
  }

  for (const tier of tiers) {
    if (chosen.length >= DISTRACTOR_COUNT) break;
    // 先 shuffle 再把易混词提到前面：sort 是稳定的，所以同类内部仍然是随机序
    const ordered = shuffle(tier, random)
      .sort((left, right) => Number(peers.has(right.id)) - Number(peers.has(left.id)));
    for (const candidate of ordered) {
      if (chosen.length >= DISTRACTOR_COUNT) break;
      const value = optionValue(candidate, kind);
      if (seen.has(value)) continue;
      seen.add(value);
      chosen.push(value);
    }
  }
  if (chosen.length < DISTRACTOR_COUNT) return null;

  const options = shuffle([answer, ...chosen], random);
  return {
    id: row.id,
    level: row.level,
    kind,
    prompt: promptFor(row, kind),
    // 拆过送假名的题要告诉用户现在问的是哪几个字，否则「培う 选 つちか」看着像少打了一个字
    readingScope: kind === "reading" ? row.core?.core : undefined,
    options,
    answerIndex: options.indexOf(answer),
    answer
  };
};

/**
 * 各等级的 `N_b·√(p_b q_b)`（Neyman 分配的权重），按参考水平 p = .9/.8/.6/.35/.15 算的。
 * 见 docs/VOCAB_TEST_BUILD.md §3.3。
 */
const LEVEL_WEIGHT: Record<string, number> = { N5: 261, N4: 334, N3: 934, N2: 1539, N1: 1435 };

/**
 * 每个等级的保底题数。
 *
 * 纯 Neyman 会把题几乎全给 N2/N1（那两带词最多、方差贡献最大），低带只剩五六题，
 * **「建议学习等级」对初学者就废了**。保底 9 是这两者的折中：
 * 60 题下总区间只比纯 Neyman 宽一点，但每个等级都还有话可说。
 */
const LEVEL_FLOOR = 9;

const levelTargets = (total: number = VOCAB_TEST_QUESTION_COUNT): Record<string, number> => {
  const out: Record<string, number> = {};
  VOCAB_TEST_LEVELS.forEach((level) => { out[level] = LEVEL_FLOOR; });
  let remaining = total - LEVEL_FLOOR * VOCAB_TEST_LEVELS.length;
  if (remaining <= 0) return out;

  const weightSum = VOCAB_TEST_LEVELS.reduce((sum, level) => sum + LEVEL_WEIGHT[level], 0);
  const shares = VOCAB_TEST_LEVELS.map((level) => {
    const want = remaining * LEVEL_WEIGHT[level] / weightSum;
    return { level, whole: Math.floor(want), fraction: want - Math.floor(want) };
  });
  shares.forEach((share) => { out[share.level] += share.whole; remaining -= share.whole; });
  // 最大余数法把除不尽的那几题补完，保证加起来正好是 total
  shares.sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; remaining > 0; index = (index + 1) % shares.length, remaining -= 1) {
    out[shares[index].level] += 1;
  }
  return out;
};

/** 摸底阶段每级几题。5×4=20 题，占 60 题的三分之一。 */
export const VOCAB_TEST_PROBE_PER_LEVEL = 4;

/**
 * 摸底之后的分配：**按实测的 p̂ 重算 Neyman 权重**，把剩下的题投到「说不准」的那一带。
 *
 * `LEVEL_WEIGHT` 那份是拿参考水平 p=.9/.8/.6/.35/.15 预先算好的 —— 对水平正好落在
 * 参考线上的人是对的，对别人就是把题浪费在早已判明的带上：一个 N1 全会的人，
 * 前 4 题就说明白了，再给他 10 道 N1 只是把 N2/N3 的精度让出去。
 *
 * p̂ 夹在 [0.15, 0.85]：一带四题全对/全错很容易是运气，权重不能直接归零 ——
 * 归零就再也没机会纠正那次运气了。
 */
const adaptiveTargets = (
  scoreByLevel: Record<string, number | null>,
  populationByLevel: Record<string, number>,
  remaining: number
): Record<string, number> => {
  const out: Record<string, number> = {};
  VOCAB_TEST_LEVELS.forEach((level) => { out[level] = 0; });
  if (remaining <= 0) return out;
  const weights = VOCAB_TEST_LEVELS.map((level) => {
    const score = clamp(scoreByLevel[level] ?? 0.5, 0.15, 0.85);
    return { level, weight: (populationByLevel[level] ?? 0) * Math.sqrt(score * (1 - score)) };
  });
  const sum = weights.reduce((total, item) => total + item.weight, 0);
  if (sum <= 0) {
    VOCAB_TEST_LEVELS.forEach((level, index) => {
      out[level] = Math.floor(remaining / VOCAB_TEST_LEVELS.length) + (index < remaining % VOCAB_TEST_LEVELS.length ? 1 : 0);
    });
    return out;
  }
  let left = remaining;
  const shares = weights.map((item) => {
    const want = remaining * item.weight / sum;
    return { level: item.level, whole: Math.floor(want), fraction: want - Math.floor(want) };
  });
  shares.forEach((share) => { out[share.level] += share.whole; left -= share.whole; });
  shares.sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; left > 0; index = (index + 1) % shares.length, left -= 1) {
    out[shares[index].level] += 1;
  }
  return out;
};

export const buildVocabTestQuestions = (
  rawRows: VocabTestWordRow[],
  random: () => number = Math.random,
  options: { targets?: Record<string, number>; total?: number; excludeIds?: Iterable<number> } = {}
): { questions: VocabTestQuestion[]; populationByLevel: Record<string, number> } => {
  const allRows = rawRows.map(enrichRow);
  const index = answerIndexBySurface(allRows);
  const populationByLevel = Object.fromEntries(VOCAB_TEST_LEVELS.map((level) => [
    level,
    allRows.filter((row) => row.level === level).length
  ]));
  const targets = options.targets ?? levelTargets();
  const total = options.total ?? VOCAB_TEST_QUESTION_COUNT;
  const questions: VocabTestQuestion[] = [];
  const used = new Set<number>(options.excludeIds ?? []);

  const addFrom = (rows: WordRow[], target: number) => {
    for (const row of shuffle(rows, random)) {
      if (questions.length >= total || questions.filter((item) => item.level === row.level).length >= target) break;
      if (used.has(row.id)) continue;
      const question = makeQuestion(row, allRows, random, index);
      if (!question) continue;
      used.add(row.id);
      questions.push(question);
    }
  };

  VOCAB_TEST_LEVELS.forEach((level) => addFrom(allRows.filter((row) => row.level === level), targets[level] ?? 0));
  if (questions.length < total) {
    addFrom(allRows, total);
  }
  return { questions: shuffle(questions, random), populationByLevel };
};

const parseSession = (raw: string): VocabTestSession | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VocabTestSession>;
    if (parsed.version !== 1 || !Array.isArray(parsed.questions) || !Array.isArray(parsed.responses)) return null;
    // 老会话没有 plannedTotal：它那时候一次就把题全出完了，题数即总数
    const questions = parsed.questions.filter((item): item is VocabTestQuestion => Boolean(
      item && Number.isFinite(Number(item.id)) && typeof item.prompt === "string"
      // ⚠️ 用常数不用字面量：这是选项数的**第二个**落点，写死过一次 5，
      // 改成 4 个选项后这里没跟着改，整场会话被静默丢掉（questions 全被过滤空 → 返回 null）。
      // 顺带这也让旧版 5 选项的未完成会话作废 —— 那是对的，它是按 wrong/4 才无偏的，
      // 拿现在的 wrong/3 去算等于给用户一个错的词汇量。
      && Array.isArray(item.options) && item.options.length === DISTRACTOR_COUNT + 1
      && Number.isInteger(Number(item.answerIndex))
    ));
    if (!questions.length) return null;
    return {
      version: 1,
      runId: asText(parsed.runId) || `vocab-${Date.now()}`,
      startedAt: Number(parsed.startedAt) || Date.now(),
      finishedAt: parsed.finishedAt == null ? null : Number(parsed.finishedAt),
      currentIndex: clamp(Math.floor(Number(parsed.currentIndex) || 0), 0, questions.length),
      questions,
      responses: parsed.responses.filter(Boolean).map((item) => ({
        questionIndex: Number(item.questionIndex),
        questionId: Number(item.questionId),
        answerState: item.answerState as VocabTestAnswerState,
        selectedOption: item.selectedOption == null ? null : Number(item.selectedOption),
        responseMs: item.responseMs == null ? null : Number(item.responseMs),
        answeredAt: Number(item.answeredAt) || Date.now()
      })),
      populationByLevel: Object.fromEntries(Object.entries(parsed.populationByLevel ?? {}).map(([key, value]) => [key, Number(value) || 0])),
      plannedTotal: Math.max(Number(parsed.plannedTotal) || 0, questions.length)
    };
  } catch {
    return null;
  }
};

const saveSession = (session: VocabTestSession): VocabTestSession => {
  setState(SESSION_KEY, JSON.stringify(session));
  persistSoon();
  return session;
};

export const getVocabTestSession = (): VocabTestSession | null => {
  ensureUserTables();
  return parseSession(getState(SESSION_KEY, ""));
};

/**
 * 开一场测验：**先只出摸底那 20 道**（每级 4 题）。
 *
 * 剩下 40 道等摸底答完再按实测水平分配（`extendVocabTestPlan`）—— 这就是
 * 「先大概估出水平，再在那个区间多出题」，只不过每一带都仍有实测数据，
 * 因为最终估计是 Σ(该级词数 × 该级答对率)，某一带没题就只能靠假设填，那不是测出来的。
 */
export const startVocabTest = (random: () => number = Math.random): VocabTestSession => {
  ensureUserTables();
  const rows = wordRows();
  const probeTargets = Object.fromEntries(VOCAB_TEST_LEVELS.map((level) => [level, VOCAB_TEST_PROBE_PER_LEVEL]));
  const probeTotal = VOCAB_TEST_PROBE_PER_LEVEL * VOCAB_TEST_LEVELS.length;
  const { questions, populationByLevel } = buildVocabTestQuestions(rows, random, {
    targets: probeTargets,
    total: probeTotal
  });
  if (questions.length < 10) throw new Error("当前词库可用于测验的词太少，无法开始测量。");
  return saveSession({
    version: 1,
    runId: `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    finishedAt: null,
    currentIndex: 0,
    questions,
    responses: [],
    populationByLevel,
    plannedTotal: VOCAB_TEST_QUESTION_COUNT
  });
};

/**
 * 摸底答完之后补齐剩下的题：按**实测**的各级答对率重算 Neyman 权重。
 *
 * 已经出过的词排掉（`excludeIds`），免得同一个词问两遍。补不出那么多题也不报错，
 * 有多少算多少 —— 词库小的用户仍然测得完。
 */
export const extendVocabTestPlan = (
  session: VocabTestSession,
  random: () => number = Math.random
): VocabTestSession => {
  const remaining = session.plannedTotal - session.questions.length;
  if (remaining <= 0) return session;
  const scoreByLevel = Object.fromEntries(VOCAB_TEST_LEVELS.map((level) => {
    const result = levelResult(level, session);
    return [level, result.rate];
  }));
  const targets = adaptiveTargets(scoreByLevel, session.populationByLevel, remaining);
  const { questions } = buildVocabTestQuestions(wordRows(), random, {
    targets,
    total: remaining,
    excludeIds: session.questions.map((question) => question.id)
  });
  if (!questions.length) return session;
  const merged = [...session.questions, ...questions];
  return saveSession({
    ...session,
    questions: merged,
    // ⚠️ 词库出不满 60 道时，总数就降到实际能出的题数。
    // 分母是「这一场一共出了几题」，不是「我们本来想出几题」——
    // 否则小词库的用户答完了所有题，可信度还要因为「没答满」被扣一截。
    plannedTotal: Math.min(session.plannedTotal, merged.length)
  });
};

export const submitVocabTestAnswer = (
  answerState: VocabTestAnswerState,
  selectedOption: number | null,
  responseMs: number | null
): VocabTestSession | null => {
  const session = getVocabTestSession();
  if (!session || session.finishedAt || session.currentIndex >= session.questions.length) return session;
  const question = session.questions[session.currentIndex];
  const response: VocabTestResponse = {
    questionIndex: session.currentIndex,
    questionId: question.id,
    answerState,
    selectedOption,
    responseMs,
    answeredAt: Date.now()
  };
  const nextIndex = session.currentIndex + 1;
  const answered = saveSession({
    ...session,
    currentIndex: nextIndex,
    responses: [...session.responses, response],
    finishedAt: nextIndex >= session.questions.length && nextIndex >= session.plannedTotal ? Date.now() : null
  });
  // 摸底那 20 道答完 → 按实测水平把剩下的题补出来（见 extendVocabTestPlan）
  if (nextIndex >= answered.questions.length && answered.questions.length < answered.plannedTotal) {
    const extended = extendVocabTestPlan(answered);
    // 补不出题（词库太小）就当场收尾，别把用户卡在一个出不来下一题的界面上
    if (extended.questions.length > answered.questions.length) return extended;
    return saveSession({
      ...answered,
      plannedTotal: answered.questions.length,
      finishedAt: answered.finishedAt ?? Date.now()
    });
  }
  return answered;
};

export const finishVocabTest = (): VocabTestSession | null => {
  const session = getVocabTestSession();
  if (!session || session.finishedAt) return session;
  return saveSession({ ...session, finishedAt: Date.now() });
};

export const clearVocabTestSession = (): void => {
  ensureUserTables();
  setState(SESSION_KEY, "");
  persistSoon();
};

/**
 * γ = 「不会但还是猜了」占不会的比例。
 *
 * 四选一时 E[W] = (1−p)·γ·¾、E[U] = (1−p)·(1−γ)，消掉 (1−p) 得
 *   γ = (4W/3) / (4W/3 + U) = 4W / (4W + 3U)
 *
 * ⚠️ **不能写成 `W / (C + W)`**。那是「答错占已作答的比例」：
 * 认真作答、只是水平不高的人（从不猜，但确实答错）会被算成在乱猜，
 * 而全靠猜且运气好的人 γ 反而低 —— 方向正好反了。
 */
export const guessRate = (wrong: number, unanswered: number): number => {
  const denominator = 4 * wrong + 3 * unanswered;
  return denominator > 0 ? (4 * wrong) / denominator : 0;
};

const levelResult = (level: string, session: VocabTestSession): VocabTestLevelResult => {
  const rows = session.responses.filter((response) => session.questions[response.questionIndex]?.level === level);
  const correct = rows.filter((row) => row.answerState === "correct").length;
  const wrong = rows.filter((row) => row.answerState === "wrong").length;
  const unknown = rows.filter((row) => row.answerState === "unknown").length;
  const timeout = rows.filter((row) => row.answerState === "timeout").length;
  const score = rows.length ? clamp((correct - wrong / 3) / rows.length, 0, 1) : null;
  return {
    level,
    total: session.populationByLevel[level] ?? 0,
    answered: rows.length,
    correct,
    wrong,
    unknown,
    timeout,
    rate: score == null ? null : Math.round(score * 100) / 100
  };
};

export const getVocabTestResult = (session: VocabTestSession | null): VocabTestResult | null => {
  if (!session) return null;
  const levels = VOCAB_TEST_LEVELS.map((level) => levelResult(level, session));
  const population = levels.reduce((sum, level) => sum + level.total, 0);
  const estimated = levels.reduce((sum, level) => sum + level.total * (level.rate ?? 0), 0);
  let variance = 0;
  levels.forEach((level) => {
    if (!level.answered || level.rate == null) {
      variance += level.total * level.total;
      return;
    }
    const gamma = guessRate(level.wrong, level.unknown + level.timeout);
    variance += level.total * level.total
      * (level.rate * (1 - level.rate) + (1 - level.rate) * gamma / 3)
      / level.answered;
  });
  const margin = session.responses.length ? Math.ceil(1.96 * Math.sqrt(Math.max(0, variance))) : population;
  const roundedEstimate = Math.round(estimated);
  // ⚠️ 题太少的等级不拿来定位：12 题里答对 7 个就是 0.58，会把 N5 推荐给一个 N2 水平的人
  const recommendation = levels.find((level) => level.rate != null && level.answered >= 5 && level.rate < 0.6)?.level ?? "N1+";
  const answered = session.responses.length;
  // 分母是「这一场原本要出几题」：摸底阶段只出了 20 道，拿它当分母会让
  // 答完摸底就退出的人看到一个虚高的可信度。
  const coverage = answered / Math.max(1, session.plannedTotal);

  const totals = levels.reduce((acc, level) => ({
    wrong: acc.wrong + level.wrong,
    unanswered: acc.unanswered + level.unknown + level.timeout,
    timeout: acc.timeout + level.timeout
  }), { wrong: 0, unanswered: 0, timeout: 0 });
  const gamma = guessRate(totals.wrong, totals.unanswered);
  const timeoutShare = answered ? totals.timeout / answered : 0;
  // 越难的等级反而答得越好 = 反常作答（person fit）。0.15 是噪声门槛：
  // 一档十来题时一两题的波动本来就会上下跳，不该算成异常。
  const rates = levels.map((level) => level.rate).filter((rate): rate is number => rate != null);
  const inversions = rates.reduce(
    (count, rate, index) => (index > 0 && rate > rates[index - 1] + 0.15 ? count + 1 : count),
    0
  );
  /**
   * 「有多少作答其实是蒙的」= (1−p)·γ = (4/3)·W/n。这是**噪声占全部作答的比例**，
   * 和 γ 不是一回事：γ 的分母是「不会的题」，这个的分母是「所有题」。
   *
   * ⚠️ 可信度要用这个，不能用 γ：一个几乎全会的人（C=50, W=5, U=5）γ 高达 0.57，
   * 但他只有 11% 的作答是蒙的，数据其实很可靠。
   */
  const guessedShare = answered ? clamp(4 * totals.wrong / (3 * answered), 0, 1) : 0;
  /**
   * 可信度 = （题量 60% + 没在赶进度 40%）**乘以**（1 − 蒙的比例），反常作答每处扣 8。
   *
   * ⚠️ 乘法不是加法。加法版本实测：**纯随机乱答 54 题拿到 61 分** ——
   * 蒙的那一项确实归零了，可题量那 45 分照给。而全靠蒙的数据不管答多少题都是废的，
   * 所以它必须能把整个分数拉到 0。
   *
   * ⚠️ **没有速度项**：答得快可能是真会、也可能是乱点，两者靠速度分不开，
   * 而「快 → 可信度高」会直接教用户抢答。
   */
  const confidence = Math.round(clamp(
    (coverage * 60 + (1 - timeoutShare) * 40) * (1 - guessedShare) - inversions * 8,
    0,
    100
  ));
  return {
    estimated: roundedEstimate,
    lower: clamp(roundedEstimate - margin, 0, population),
    upper: clamp(roundedEstimate + margin, 0, population),
    population,
    answered,
    totalQuestions: session.plannedTotal,
    confidence,
    gamma: Math.round(gamma * 100) / 100,
    guessedShare: Math.round(guessedShare * 100) / 100,
    timeoutShare: Math.round(timeoutShare * 100) / 100,
    recommendation,
    levels
  };
};

export interface VocabTestHistoryRow {
  runId: string;
  startedAt: number;
  finishedAt: number;
  durationSeconds: number;
  answered: number;
  totalQuestions: number;
  estimated: number;
  lower: number;
  upper: number;
  confidence: number;
  recommendation: string;
  /** 各级答对率，给分享图画横条用 */
  levels: { level: string; rate: number | null; answered: number }[];
}

/**
 * 一次测验真正花在答题上的秒数。
 *
 * ⚠️ **不能用 `finishedAt − startedAt`。** 那是墙上时间：中途切走、关掉 App、
 * 第二天回来接着答，全都算进去 —— 实测出过一条「2 题 · 用时 4160 分 36 秒」。
 *
 * 用每题的 `responseMs` 求和，并且**每题按它自己的时限封顶**：超过时限的部分
 * 一定是「人不在」（页面切走时计时器停了，但 questionStartedAt 还停在原地），
 * 不是他在思考。
 */
const activeSeconds = (session: VocabTestSession): number => {
  const total = session.responses.reduce((sum, response) => {
    const question = session.questions[response.questionIndex];
    const limit = secondsForQuestion(question ?? { kind: "reading" }) * 1000;
    return sum + clamp(Number(response.responseMs ?? 0), 0, limit);
  }, 0);
  return Math.max(0, Math.round(total / 1000));
};

/**
 * 把一次测完的结果追加进历史。
 *
 * **按 run_id 幂等**：结果页可以来回进出、刷新，写的还是同一行。
 * 一题没答的会话不记 —— 那不是一次测验，是打开看了一眼。
 */
export const recordVocabTestRun = (session: VocabTestSession | null): void => {
  if (!session || session.responses.length === 0) return;
  const result = getVocabTestResult(session);
  if (!result) return;
  ensureUserTables();
  const finishedAt = session.finishedAt ?? Date.now();
  getDatabase().run(`
    INSERT OR IGNORE INTO vocab_test_history (
      run_id, started_at, finished_at, duration_seconds,
      answered, total_questions, estimated, lower_bound, upper_bound, confidence, recommendation, levels_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    session.runId,
    new Date(session.startedAt).toISOString(),
    new Date(finishedAt).toISOString(),
    activeSeconds(session),
    result.answered,
    result.totalQuestions,
    result.estimated,
    result.lower,
    result.upper,
    result.confidence,
    result.recommendation,
    JSON.stringify(result.levels.map((level) => [level.level, level.rate, level.answered]))
  ]);
  persistSoon();
};

const parseLevels = (raw: string): VocabTestHistoryRow["levels"] => {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      level: String(item?.[0] ?? ""),
      rate: item?.[1] == null ? null : Number(item[1]),
      answered: Number(item?.[2] ?? 0)
    })).filter((item) => item.level);
  } catch {
    return [];
  }
};

export const getVocabTestHistory = (limit = 20): VocabTestHistoryRow[] => {
  ensureUserTables();
  return rowsFor(`
    SELECT * FROM vocab_test_history ORDER BY finished_at DESC LIMIT ?
  `, [limit]).map((row) => ({
    runId: String(row.run_id ?? ""),
    startedAt: Date.parse(String(row.started_at ?? "")) || 0,
    finishedAt: Date.parse(String(row.finished_at ?? "")) || 0,
    // 早一版按墙上时间记过（切走、隔夜回来都算进去），按「每题最长 20 秒」封顶
    durationSeconds: Math.min(Number(row.duration_seconds ?? 0), Number(row.answered ?? 0) * 20),
    answered: Number(row.answered ?? 0),
    totalQuestions: Number(row.total_questions ?? 0),
    estimated: Number(row.estimated ?? 0),
    lower: Number(row.lower_bound ?? 0),
    upper: Number(row.upper_bound ?? 0),
    confidence: Number(row.confidence ?? 0),
    recommendation: String(row.recommendation ?? ""),
    levels: parseLevels(String(row.levels_json ?? ""))
  }));
};

/** 测试只读查询是否真的没有碰学习流水。 */
export const vocabTestStorageValue = (): string => firstValue<string>(
  "SELECT value FROM app_state WHERE key = ?",
  [SESSION_KEY],
  ""
);
