export const PROGRESS_UPDATED_EVENT = "shushugo-progress-updated";
export const TODAY_WORD_PLAN_UPDATED_EVENT = "shushugo-today-word-plan-updated";
export type TodayWordAudioPlanItem = { kanji: string; kana: string; example: string };

let muted = 0;
let latestTodayWordAudioPlan: readonly TodayWordAudioPlanItem[] = [];

/**
 * 预算下一张卡（word-api 的 previewNextWordCard）是在 SAVEPOINT 里真的把作答走一遍再回滚：
 * 那一刻的库是马上要撤掉的假状态。监听者（小路、主页概览）是同步读库的，不压住就会把假进度画出来。
 */
export const withProgressEventsMuted = <T>(run: () => T): T => {
  muted += 1;
  try {
    return run();
  } finally {
    muted -= 1;
  }
};

export const notifyProgressUpdated = () => {
  if (muted) return;
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));
};

export const readTodayWordAudioPlanUpdate = () => latestTodayWordAudioPlan;

export const notifyTodayWordPlanUpdated = (plan: readonly TodayWordAudioPlanItem[]) => {
  latestTodayWordAudioPlan = plan;
  window.dispatchEvent(new Event(TODAY_WORD_PLAN_UPDATED_EVENT));
};
