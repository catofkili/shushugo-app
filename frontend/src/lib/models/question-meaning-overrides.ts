import payload from "../../data/question_meaning_overrides.json";

export interface QuestionMeaningOverride {
  kanji: string;
  kana: string;
  questionMeaning: string;
}

const entries = payload as QuestionMeaningOverride[];
const byPair = new Map(entries.map((entry) => [pairKey(entry.kanji, entry.kana), entry.questionMeaning]));

function pairKey(kanji: string, kana: string): string {
  return `${kanji}\u0000${kana}`;
}

export function reviewedQuestionMeaning(kanji: string, kana: string): string | undefined {
  return byPair.get(pairKey(kanji, kana));
}

export function reviewedQuestionMeaningEntries(): readonly QuestionMeaningOverride[] {
  return entries;
}
