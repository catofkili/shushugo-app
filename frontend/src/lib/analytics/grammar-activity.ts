import { getDatabase } from "../database";
import { studyDate } from "../database/db-utils";

/** 记录语法查阅/标记动作，供周报统计；不触碰语法 FSRS 状态。 */
export function recordGrammarActivity(grammarId: string, answer = "read", atMs = Date.now()): void {
  if (!grammarId) return;
  try {
    getDatabase().run(
      `INSERT INTO grammar_activity_events (grammar_id, answer, activity_at, activity_on) VALUES (?, ?, ?, ?)`,
      [grammarId, answer, atMs, studyDate(new Date(atMs))]
    );
  } catch {
    // 语法阅读是可选统计，数据库迁移/旧库未完成时不能阻断阅读。
  }
}
