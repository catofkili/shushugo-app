import { syncJlptPlanNotifications } from "../notifications";
import { getJlptPlanStatus } from "./status";
import { shortfallText } from "./plan";

/**
 * 把「当前计划状态」翻译成通知层要的扁平结构,再排进系统。
 *
 * 单独一个文件是为了让 notifications.ts 不 import 数据库:
 * 通知那边只认数字和字符串,取数和算量都留在这一侧。
 */
export async function syncJlptPlanReminders(): Promise<void> {
  let status;
  try {
    status = getJlptPlanStatus();
  } catch {
    // 词库还没就绪就先不排,下次启动或进计划页时会再来一次
    return;
  }

  if (!status.enabled) {
    await syncJlptPlanNotifications(null);
    return;
  }

  await syncJlptPlanNotifications({
    target: status.target,
    daysLeft: status.plan.daysLeft,
    todayText: shortfallText(status.shortfall),
    todayClear: status.shortfall.clear,
    newWordsPerDay: status.plan.newWords,
    newGrammarPerDay: status.plan.newGrammar,
    feasible: status.plan.feasible
  });
}
