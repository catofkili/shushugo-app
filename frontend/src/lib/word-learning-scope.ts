import { optionalWordSql } from "./collocation-tier";
import { getStudyPreferences } from "./studyPreferences";

/** 任一方向的真实流水、见过或已有 FSRS 都不再是新词；先验同样属于已开始的卡。 */
export const wordStartedSql = (p = "p") => `(
  COALESCE(${p}.seen_count, 0) > 0 OR ${p}.fsrs_state IS NOT NULL
  OR ${p}.fsrs_due IS NOT NULL OR ${p}.fsrs_stability IS NOT NULL OR ${p}.fsrs_last_review IS NOT NULL
  OR EXISTS (SELECT 1 FROM reviews started_review WHERE started_review.word_id = ${p}.word_id)
)`;

/** 开关只控制未学 optional；已学/熟知的行始终保留在学习总量和复习中。 */
export const wordLearningScopeSql = (w = "w", p = "p", includeOptional = getStudyPreferences().includeOptionalExpressions) =>
  includeOptional ? "1" : `(NOT (${optionalWordSql(`${w}.id`)}) OR COALESCE(${p}.known_forever, 0) = 1 OR ${wordStartedSql(p)})`;

export const newWordEligibleSql = (w = "w", p = "p", includeOptional = getStudyPreferences().includeOptionalExpressions) =>
  `(COALESCE(${p}.known_forever, 0) = 0 AND NOT ${wordStartedSql(p)} AND ${wordLearningScopeSql(w, p, includeOptional)})`;
