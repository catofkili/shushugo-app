import {
  confusionGroups,
  confusionGroupsForWord,
  displayForm,
  setConfusionMastered,
  type ConfusionGroup,
  type ConfusionType
} from "./confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";
import { matchable } from "./confusion-cards";
import { reviewedQuestionMeaning } from "./models/question-meaning-overrides";
import { firstValue, rowsFor, today } from "./database/db-utils";
import { shuffle } from "./vocab-test";

export interface DistinctionQuestion {
  groupKey: string;
  prompt: string;
  /** reading-register 组（明日 あした / あす）两个选项词形一样，读音才是答案，所以选项必须带 kana。 */
  options: { id: number; surface: string; kana: string }[];
  answerId: number;
  summary: string;
  notes: Map<string, string>;
}

export type QuizScope =
  | { kind: "group"; key: string }
  | { kind: "type"; type: ConfusionType }
  | { kind: "today" }
  | { kind: "learned" };

const firstSense = (text: string): string => text.split(/[；;]/)[0].trim();

const reviewable = (group: ConfusionGroup): boolean => {
  const review = distinctionReviewFor(group.key);
  if (!review || !matchable(group)) return false;
  const senses = new Set<string>();
  const ids = new Set<number>();
  return group.members.every((member) => {
    if (ids.has(member.id)) return false;
    ids.add(member.id);
    const meaning = reviewedQuestionMeaning(member.kanji, member.kana);
    if (!meaning) return false;
    const sense = firstSense(meaning);
    if (senses.has(sense)) return false;
    senses.add(sense);
    return true;
  });
};

const groupsByIds = (ids: Set<number>): ConfusionGroup[] => {
  const found = new Map<string, ConfusionGroup>();
  ids.forEach((id) => confusionGroupsForWord(id).forEach((group) => found.set(group.key, group)));
  return [...found.values()];
};

const reviewedIdsToday = (): Set<number> => new Set(rowsFor(
  "SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",
  [today()]
).map((row) => Number(row.word_id ?? 0)).filter(Boolean));

const learnedIds = (): Set<number> => {
  const hasBaselines = firstValue<number>("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='level_prior_baselines'", [], 0) > 0;
  return new Set(rowsFor(`SELECT p.word_id FROM progress p WHERE p.known_forever = 1
    OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id AND r.direction = 'forward')
    OR (p.seen_count > 0${hasBaselines ? ` AND NOT EXISTS (
      SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
    )` : ""})`).map((row) => Number(row.word_id ?? 0)).filter(Boolean));
};

export function quizGroups(scope: QuizScope): ConfusionGroup[] {
  let groups: ConfusionGroup[];
  if (scope.kind === "group") {
    groups = confusionGroups().filter((group) => group.key === scope.key);
  } else if (scope.kind === "type") {
    groups = confusionGroups().filter((group) => group.type === scope.type);
  } else {
    groups = groupsByIds(scope.kind === "today" ? reviewedIdsToday() : learnedIds());
    if (scope.kind === "learned") {
      const ids = learnedIds();
      groups = groups.filter((group) => group.members.filter((member) => ids.has(member.id)).length >= 2);
    }
  }
  return groups.filter(reviewable);
}

/** 能出题的组 key；辨析页拿它决定「练这组」按钮出不出现，别按组逐个调 quizGroups。 */
export const playableGroupKeys = (): Set<string> =>
  new Set(confusionGroups().filter(reviewable).map((group) => group.key));

export function buildQuestions(
  groups: ConfusionGroup[],
  rng: () => number = Math.random
): DistinctionQuestion[] {
  const questions: DistinctionQuestion[] = [];
  for (const group of shuffle(groups, rng)) {
    const review = distinctionReviewFor(group.key);
    if (!reviewable(group) || !review) continue;
    if (questions.length + group.members.length > 24) continue;
    const notes = distinctionNotesFor(review.summary, group.members.map((member) => ({
      key: String(member.id),
      forms: [displayForm(member), member.kanji, member.kana]
    })));
    const options = shuffle(group.members.map((member) => ({
      id: member.id,
      surface: displayForm(member),
      kana: member.kana
    })), rng);
    for (const member of group.members) {
      const prompt = reviewedQuestionMeaning(member.kanji, member.kana);
      if (!prompt) continue;
      questions.push({
        groupKey: group.key,
        prompt,
        options,
        answerId: member.id,
        summary: review.summary,
        notes
      });
    }
    if (questions.length === 24) return questions;
  }
  return questions;
}

export const settleGroup = (groupKey: string, allCorrect: boolean): void => {
  setConfusionMastered(groupKey, allCorrect);
};
