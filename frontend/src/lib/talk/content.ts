export interface TalkFiller {
  ja: string;
  zh: string;
  wordId?: number;
}

export interface TalkFormula {
  id: string;
  intent: string;
  pattern: string;
  skeleton: string;
  prompt: string;
  note: string;
  fillers: Array<Record<string, TalkFiller>>;
  scene?: string;
}

export interface TalkScene {
  id: string;
  title: string;
  note?: string;
  lines: Array<{
    speaker: string;
    self: boolean;
    ja: string;
    zh: string;
    formulas: string[];
  }>;
}

export interface TalkContent {
  version: string;
  formulas: TalkFormula[];
  scenes: TalkScene[];
}

let loaded: TalkContent | null = null;
let loading: Promise<void> | null = null;

export const loadTalkContent = (): Promise<void> => {
  if (loaded) return Promise.resolve();
  loading ??= import("../../data/talk_content.json").then((module) => {
    loaded = module.default as TalkContent;
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
};

export const talkContentLoaded = (): boolean => loaded !== null;
export const talkContent = (): TalkContent | null => loaded;

/** 测试只注入 fixture，不依赖与内容任务合并时会替换的 stub。 */
export const setTalkContentForTest = (content: TalkContent | null): void => {
  loaded = content;
  loading = null;
};
