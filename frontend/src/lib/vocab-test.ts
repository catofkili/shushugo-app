import { ensureUserTables } from "./study-core";
import { firstValue, persistSoon, rowsFor, setState, getState, type DbRow } from "./study-core";
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
  questions: VocabTestQuestion[];
  responses: VocabTestResponse[];
  populationByLevel: Record<string, number>;
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

/** 干扰项的三条硬约束（见 docs/VOCAB_TEST_BUILD.md §2.2）在这里算一次，别在循环里重算。 */
type WordRow = VocabTestWordRow & {
  posBucket: PosBucket;
  morae: number;
  loan: boolean;
};

const enrichRow = (row: VocabTestWordRow): WordRow => ({
  ...row,
  posBucket: classifyPos(row.pos ?? ""),
  morae: moraCount(row.kana),
  loan: isLoanwordSourceSurface({ kanji: row.kanji, kana: row.kana })
});

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
const isReadingQuestion = (row: WordRow): boolean => shouldStudyKanjiReading(row);

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
    [preferredWordSurface(row), kanjiReadingSurface(row)].forEach((surface) => {
      push(readings, surface, row.kana.trim());
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
  (kind === "reading" ? row.kana : row.meaning).trim();

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
  const startsWith = (n: number) => (row: WordRow) => row.kana !== answer && row.kana.startsWith(prefix(n));
  const endsWith = (n: number) => (row: WordRow) => row.kana !== answer && row.kana.endsWith(suffix(n));
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
        .find((item) => !seen.has(item.kana) && !nestedReading(answer, item.kana));
      if (!candidate) return;
      seen.add(candidate.kana);
      chosen.push(candidate.kana);
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

export const buildVocabTestQuestions = (
  rawRows: VocabTestWordRow[],
  random: () => number = Math.random
): { questions: VocabTestQuestion[]; populationByLevel: Record<string, number> } => {
  const allRows = rawRows.map(enrichRow);
  const index = answerIndexBySurface(allRows);
  const populationByLevel = Object.fromEntries(VOCAB_TEST_LEVELS.map((level) => [
    level,
    allRows.filter((row) => row.level === level).length
  ]));
  const targets = levelTargets();
  const questions: VocabTestQuestion[] = [];
  const used = new Set<number>();

  const addFrom = (rows: WordRow[], target: number) => {
    for (const row of shuffle(rows, random)) {
      if (questions.length >= VOCAB_TEST_QUESTION_COUNT || questions.filter((item) => item.level === row.level).length >= target) break;
      if (used.has(row.id)) continue;
      const question = makeQuestion(row, allRows, random, index);
      if (!question) continue;
      used.add(row.id);
      questions.push(question);
    }
  };

  VOCAB_TEST_LEVELS.forEach((level) => addFrom(allRows.filter((row) => row.level === level), targets[level]));
  if (questions.length < VOCAB_TEST_QUESTION_COUNT) {
    addFrom(allRows, VOCAB_TEST_QUESTION_COUNT);
  }
  return { questions: shuffle(questions, random), populationByLevel };
};

const parseSession = (raw: string): VocabTestSession | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VocabTestSession>;
    if (parsed.version !== 1 || !Array.isArray(parsed.questions) || !Array.isArray(parsed.responses)) return null;
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
      populationByLevel: Object.fromEntries(Object.entries(parsed.populationByLevel ?? {}).map(([key, value]) => [key, Number(value) || 0]))
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

export const startVocabTest = (random: () => number = Math.random): VocabTestSession => {
  ensureUserTables();
  const rows = wordRows();
  const { questions, populationByLevel } = buildVocabTestQuestions(rows, random);
  if (questions.length < 10) throw new Error("当前词库可用于测验的词太少，无法开始测量。");
  return saveSession({
    version: 1,
    runId: `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    finishedAt: null,
    currentIndex: 0,
    questions,
    responses: [],
    populationByLevel
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
  return saveSession({
    ...session,
    currentIndex: nextIndex,
    responses: [...session.responses, response],
    finishedAt: nextIndex >= session.questions.length ? Date.now() : null
  });
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
  const coverage = answered / Math.max(1, session.questions.length);

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
    totalQuestions: session.questions.length,
    confidence,
    gamma: Math.round(gamma * 100) / 100,
    guessedShare: Math.round(guessedShare * 100) / 100,
    timeoutShare: Math.round(timeoutShare * 100) / 100,
    recommendation,
    levels
  };
};

/** 测试只读查询是否真的没有碰学习流水。 */
export const vocabTestStorageValue = (): string => firstValue<string>(
  "SELECT value FROM app_state WHERE key = ?",
  [SESSION_KEY],
  ""
);
