import type { Page, StudyMode } from "../types/app";

const KEY = "mn-active-study-mode";

/**
 * 散在各处的入口收敛成五个**平级**模式,都由用户自己挑:
 *
 * - 经典   今日计划(FSRS 排的当日到期集)
 * - 错题本 换选词通道:长期薄弱词池,不碰今日计划
 * - 快速   还是今日计划的词,换成一页 50 张的翻页形态(自己有一页)
 * - 反向   日语 → 释义,自己一份 FSRS 记忆(reverse_memory)
 * - 汉字   释义 → 汉字,自己一份 FSRS 记忆(kanji_memory),只收含汉字的词
 *
 * 反向和汉字以前是「今日计划做完后自动接上的第二、第三阶段」——做完 985 个词的当下
 * 又被塞 985 道反向题。现在自动衔接已经拆掉(见 word-api 的 resolveNextCard),
 * 它们和经典、错题本一样,想练的时候自己进。
 *
 * 「词汇学习」不在列:它和经典是同一条代码路径,只是标题不同。
 */
export const STUDY_MODES: {
  id: StudyMode;
  /** 完整标题 */
  title: string;
  /** 芯片/轨道上的短名(位置只够两三个字) */
  short: string;
  /** 页眉上的英文角标 */
  label: string;
  subtitle: string;
  description: string;
  emoji: string;
  /** 不进单词学习页、而是自己有一页的模式(快速复习) */
  page?: Extract<Page, "quick-study">;
}[] = [
  {
    id: "classic",
    title: "经典模式",
    short: "经典",
    label: "Classic",
    subtitle: "今日计划",
    description: "按 FSRS 排的当日到期集出题，释义 → 日语。",
    emoji: "🐿️"
  },
  {
    id: "mistakes",
    title: "学习错题本",
    short: "错题本",
    label: "Mistakes",
    subtitle: "长期薄弱词",
    description: "从长期错误率和记忆难度挑仍不牢固的词，集中攻坚，不占今日计划。",
    emoji: "🧠"
  },
  {
    id: "quick",
    title: "快速复习",
    short: "快速",
    label: "Quick",
    subtitle: "一页 50 张",
    description: "同样是今日计划的词，但一页铺 50 张翻着看，适合零碎时间扫一遍。",
    emoji: "📝",
    page: "quick-study"
  },
  {
    id: "reverse",
    title: "反向学习",
    short: "反向",
    label: "Reverse",
    subtitle: "日语 → 释义",
    description: "出日语，回忆中文释义。和经典一样有自己的到期集和毕业判定，新卡从正向的熟练度折算。",
    emoji: "🔁"
  },
  {
    id: "kanji",
    title: "汉字学习",
    short: "汉字",
    label: "Kanji",
    subtitle: "释义 → 汉字",
    description: "专门回忆和式汉字。规则同经典，只收含汉字的词，新卡从正向的熟练度折算。",
    emoji: "🈶"
  }
];

const modes = new Set<StudyMode>(STUDY_MODES.map((mode) => mode.id));

export const defaultStudyMode: StudyMode = "classic";

export const studyModeInfo = (mode: StudyMode) =>
  STUDY_MODES.find((item) => item.id === mode) ?? STUDY_MODES[0];

export function getStudyMode(): StudyMode {
  const value = localStorage.getItem(KEY) as StudyMode | null;
  // 老数据里的 "vocabulary"(已删,和经典同路径)和任何非法值都归到默认模式
  return value && modes.has(value) ? value : defaultStudyMode;
}

export function saveStudyMode(mode: StudyMode): StudyMode {
  const safeMode = modes.has(mode) ? mode : defaultStudyMode;
  localStorage.setItem(KEY, safeMode);
  return safeMode;
}
