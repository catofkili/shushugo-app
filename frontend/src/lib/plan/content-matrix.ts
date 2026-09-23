import { consolidationDays, daysBetween, JLPT_TARGETS, MAX_DAILY_NEW_GRAMMAR, MAX_DAILY_NEW_WORDS, type JlptTarget } from "../jlpt/plan";
import type { Familiarity, StartingLevel } from "../level-plan";

type Kind = keyof Familiarity;
export type ContentCounts = Record<Kind, number>;

/** 出厂库加启动时的固定搭配迁移：单词/语法按 JLPT 级别，汉字/辨析按素材 level_rank。内容变动时测试会报错。 */
export const CONTENT_BY_LEVEL: Record<JlptTarget, ContentCounts> = {
  N5: { words: 929, grammar: 127, kanji: 448, confusion: 20 },
  N4: { words: 886, grammar: 136, kanji: 362, confusion: 48 },
  N3: { words: 2144, grammar: 146, kanji: 408, confusion: 110 },
  N2: { words: 3626, grammar: 155, kanji: 390, confusion: 292 },
  N1: { words: 4216, grammar: 205, kanji: 362, confusion: 545 }
};

export const VISIBLE_STARTS: Array<Exclude<StartingLevel, "beyond">> = ["kana-none", "kana", ...JLPT_TARGETS];
const KINDS: Kind[] = ["words", "grammar", "kanji", "confusion"];
const zero = (): ContentCounts => ({ words: 0, grammar: 0, kanji: 0, confusion: 0 });

/** 进入设定页前一次生成全部 35 种起点×目标组合；点选时只查表。 */
export const CONTENT_MATRIX = Object.fromEntries(VISIBLE_STARTS.map((start) => [start,
  Object.fromEntries(JLPT_TARGETS.map((target) => {
    const startRank = JLPT_TARGETS.indexOf(start as JlptTarget);
    const targetRank = JLPT_TARGETS.indexOf(target);
    const counts = zero();
    for (let rank = startRank + 1; rank <= targetRank; rank += 1) {
      for (const kind of KINDS) counts[kind] += CONTENT_BY_LEVEL[JLPT_TARGETS[rank]][kind];
    }
    return [target, counts];
  }))
])) as Record<Exclude<StartingLevel, "beyond">, Record<JlptTarget, ContentCounts>>;

export const expectedContent = (start: StartingLevel, target: JlptTarget, familiarity?: Familiarity): ContentCounts => {
  if (start === "beyond") return zero();
  const counts = { ...CONTENT_MATRIX[start][target] };
  // 自报 N4 但把单词熟悉度调到 0，N4 词也必须进入新学，而不是只算 N3。
  if (JLPT_TARGETS.includes(start as JlptTarget) && JLPT_TARGETS.indexOf(start as JlptTarget) <= JLPT_TARGETS.indexOf(target)) {
    for (const kind of KINDS) if (familiarity?.[kind] === 0) counts[kind] += CONTENT_BY_LEVEL[start as JlptTarget][kind];
  }
  return counts;
};

const CAPS: ContentCounts = { words: MAX_DAILY_NEW_WORDS, grammar: MAX_DAILY_NEW_GRAMMAR, kanji: 50, confusion: 20 };

export const previewLevelPlan = (input: {
  startingLevel: StartingLevel;
  target: JlptTarget;
  examDate: Date;
  familiarity?: Familiarity;
  today?: Date;
  startedOn?: Date;
  kanaCompleted?: boolean;
}) => {
  const today = input.today ?? new Date();
  const daysLeft = daysBetween(today, input.examDate);
  const totalDays = daysBetween(input.startedOn ?? today, input.examDate);
  const reviewDays = consolidationDays(totalDays);
  // 不懂五十音时先预留约一周；真正解锁由 92 张基础假名的掌握进度决定。
  const kanaDays = input.startingLevel === "kana-none" && !input.kanaCompleted ? 7 : 0;
  const intakeDays = Math.max(0, daysLeft - reviewDays - kanaDays);
  const content = expectedContent(input.startingLevel, input.target, input.familiarity);
  const required = Object.fromEntries(KINDS.map((kind) => [kind, Math.ceil(content[kind] / Math.max(1, intakeDays))])) as ContentCounts;
  const daily = Object.fromEntries(KINDS.map((kind) => [kind, Math.min(required[kind], CAPS[kind])])) as ContentCounts;
  const feasible = daysLeft > 0 && intakeDays > 0 && KINDS.every((kind) => required[kind] <= CAPS[kind]);
  return { content, required, daily, daysLeft, intakeDays, reviewDays, kanaDays, feasible };
};
