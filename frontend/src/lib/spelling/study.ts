import { firstValue } from "../database/db-utils";
import { LEECH_LAPSE_THRESHOLD } from "../fsrs-scheduler";
import { optionalWordSql } from "../collocation-tier";

/** 调度结果由正常作答预算提供，这里只决定卡面的作答方式，不选词、不改队列。 */
export const shouldSpellWord = (wordId: number, graduatedAfterKnow: boolean, enabled: boolean, phase: string, special = false): boolean => {
  if (!enabled || phase !== "stage1" || special) return false;
  return Boolean(firstValue<number>(`
    SELECT EXISTS(SELECT 1 FROM progress p LEFT JOIN spelling_memory s ON s.word_id = p.word_id
      WHERE p.word_id = ? AND p.known_forever = 0
        -- 选学表达只认读；保留原拼写记录和 always_spell，改档后仍可恢复。
        AND NOT (${optionalWordSql("p.word_id")})
        -- 「一直拼写」优先于顽固词排除：作者原话「不再回到非拼写模式」（2026-10-12）。
        AND (COALESCE(s.always_spell, 0) = 1 OR (? = 1 AND COALESCE(p.fsrs_lapses, 0) < ?)))
  `, [wordId, graduatedAfterKnow ? 1 : 0, LEECH_LAPSE_THRESHOLD], 0));
};
