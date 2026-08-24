import type { Page, StudyMode } from "../types/app";
import { studyDate } from "./database/db-utils";

const KEY = "mn-active-study-mode";
const AUTO_MISTAKES_KEY = "mn-auto-mistakes-mode";

/**
 * 散在各处的入口收敛成五个**平级**模式。用户平时自己挑；正常模式的
 * 当日任务完成后，会在本学习日余下时间临时切到错题本，次日 4 点恢复:
 *
 * - 经典   今日计划(FSRS 排的当日到期集)
 * - 错题本 换选词通道:长期薄弱词池,不碰今日计划
 * - 快速   还是今日计划的词,换成一页 50 张的翻页形态(自己有一页)
 * - 反向   日语 → 释义,自己一份 FSRS 记忆(reverse_memory)
 * - 汉字读音 看日文表记,只遮汉字对应读音,自己一份 FSRS 记忆,只收含汉字的词
 *
 * 反向和汉字以前是「今日计划做完后自动接上的第二、第三阶段」——做完 985 个词的当下
 * 又被塞 985 道反向题。现在自动衔接已经拆掉(见 word-api 的 resolveNextCard),
 * 它们和经典、错题本一样,想练的时候自己进。
 *
 * 「词汇学习」不在列:它和经典是同一条代码路径,只是标题不同。
 *
 * 「自选清单」是第六个,但 hidden —— 它没有固定的词池,得先去词库勾一批词,
 * 所以入口只在词库页,不摆进模式列表(那五个仍然是平级的五个)。
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
  /** 不摆进模式列表:没有固定词池,得从别处带着一批词进来 */
  hidden?: boolean;
  /** 不写进「上次用的模式」:下次开应用不该莫名其妙停在一份旧清单上 */
  transient?: boolean;
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
    title: "汉字读音",
    short: "汉字",
    label: "Kanji",
    subtitle: "看表记 → 回忆读音",
    description: "显示日文表记和释义，只遮住汉字对应的假名；点卡片揭晓读音。只收含汉字的词。",
    emoji: "🈶"
  },
  {
    id: "picked",
    title: "自选清单",
    short: "自选",
    label: "Picked",
    subtitle: "你在词库里勾的词",
    description: "只出勾中的那批词，不看到期与否，也不占今日计划。考前突击用。",
    emoji: "🎯",
    hidden: true,
    transient: true
  }
];

/** 摆进模式列表的那五个。自选清单要先有清单，入口在词库页。 */
export const VISIBLE_STUDY_MODES = STUDY_MODES.filter((mode) => !mode.hidden);

const modes = new Set<StudyMode>(STUDY_MODES.map((mode) => mode.id));

interface AutoMistakesState {
  studyDate: string;
  returnMode: StudyMode;
  /**
   * 用户在自动切换之后又手动挑了模式。手动选择永远优先,所以这条记录只留下
   * 「今天已经自动切过一次」的事实,不再生效 —— 当天不会二次自动切换。
   */
  dismissed?: boolean;
}

export const defaultStudyMode: StudyMode = "classic";

export const studyModeInfo = (mode: StudyMode) =>
  STUDY_MODES.find((item) => item.id === mode) ?? STUDY_MODES[0];

const safeMode = (value: unknown): StudyMode =>
  typeof value === "string" && modes.has(value as StudyMode)
    ? value as StudyMode
    : defaultStudyMode;

const readAutoMistakesState = (): AutoMistakesState | null => {
  const raw = localStorage.getItem(AUTO_MISTAKES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutoMistakesState>;
    if (typeof parsed.studyDate !== "string") return null;
    return {
      studyDate: parsed.studyDate,
      returnMode: safeMode(parsed.returnMode),
      dismissed: parsed.dismissed === true
    };
  } catch {
    return null;
  }
};

/** localStorage 里持久化的那个选择(不含自动切换的临时覆盖) */
const savedStudyMode = (): StudyMode => {
  const value = localStorage.getItem(KEY) as StudyMode | null;
  // 老数据里的 "vocabulary"(已删,和经典同路径)和任何非法值都归到默认模式
  return value && modes.has(value) ? value : defaultStudyMode;
};

/**
 * 当前真正要启动的模式。
 *
 * 正常模式当天完成后只临时覆盖成错题本，不改掉用户原本的选择；跨过
 * 凌晨 4 点的学习日边界后，临时覆盖失效并恢复原模式。
 * 用户手动挑过模式(dismissed)之后，当天不再有任何自动覆盖。
 */
export function getStudyMode(current = new Date()): StudyMode {
  const autoState = readAutoMistakesState();
  if (autoState?.studyDate === studyDate(current)) {
    return autoState.dismissed ? savedStudyMode() : "mistakes";
  }
  if (autoState) {
    // 跨过学习日边界:没被手动否决过的才需要恢复原模式,否决过的 KEY 里
    // 已经是用户自己的选择,直接丢掉记录就行。
    if (!autoState.dismissed) localStorage.setItem(KEY, autoState.returnMode);
    localStorage.removeItem(AUTO_MISTAKES_KEY);
  }

  return savedStudyMode();
}

export function saveStudyMode(mode: StudyMode, current = new Date()): StudyMode {
  const savedMode = safeMode(mode);
  // 临时模式(自选清单)只启动、不记账:记下去的话下次开应用会停在一份旧清单上,
  // 而清单是「这一次想突击这些」,不是一个长期偏好。
  if (!studyModeInfo(savedMode).transient) localStorage.setItem(KEY, savedMode);

  // 手动选择永远优先。但不能直接删掉记录 —— 删了就等于「今天还没自动切过」,
  // 下次再进已完成的模式又会被切走一次。保留日期、只标记失效。
  const autoState = readAutoMistakesState();
  if (autoState?.studyDate === studyDate(current)) {
    localStorage.setItem(AUTO_MISTAKES_KEY, JSON.stringify({
      ...autoState,
      dismissed: true
    } satisfies AutoMistakesState));
  } else if (autoState) {
    localStorage.removeItem(AUTO_MISTAKES_KEY);
  }
  return savedMode;
}

/**
 * 当日正常任务完成后，把余下学习时间临时交给错题本。
 *
 * **每个学习日只切一次**：completionReportedRef 只在 WordStudy 本次挂载内防重复，
 * 重新进一次已完成的模式就会再报一次完成，所以这里必须按学习日自己去重，
 * 否则用户手动切回经典、再进一次，又被夺走。
 */
export function activateMistakesForToday(returnMode: StudyMode, current = new Date()): StudyMode {
  const savedReturnMode = safeMode(returnMode);
  if (savedReturnMode === "mistakes") return savedReturnMode;

  const autoState = readAutoMistakesState();
  if (autoState?.studyDate === studyDate(current)) {
    // 今天已经自动切过了(可能已被用户否决),不再重复触发。
    return autoState.dismissed ? savedStudyMode() : "mistakes";
  }

  localStorage.setItem(KEY, savedReturnMode);
  localStorage.setItem(AUTO_MISTAKES_KEY, JSON.stringify({
    studyDate: studyDate(current),
    returnMode: savedReturnMode
  } satisfies AutoMistakesState));
  return "mistakes";
}
