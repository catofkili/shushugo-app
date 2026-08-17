import type { GrammarPoint } from "../types/grammar";

export interface GrammarFormRange {
  start: number;
  end: number;
  text: string;
}

const PLACEHOLDERS = /[～〜…]/gu;
const splitPattern = /[／/、，,＋+\s「」『』（）()【】\[\]]/u;
const genericPart = /^(?:名詞|动词|動詞|形容词|形容詞|副词|副詞|普通形|辞書形|基本形|ます形|マス形|た形|タ形|ない形|ナイ形|て形|テ形|語幹|词干|[ⅠⅡⅢ一二三]類|ます|です|ない|た|て|で|だ)$/u;

const inflectedVariants = (part: string): string[] => {
  const variants = new Set([part]);
  if (part.endsWith("る") && part.length > 1) {
    const stem = part.slice(0, -1);
    [stem, `${stem}ます`, `${stem}ました`, `${stem}ません`, `${stem}ない`, `${stem}なかった`, `${stem}た`, `${stem}て`]
      .forEach((variant) => variants.add(variant));
  }
  return [...variants];
};

/**
 * Return the longest literal grammar-form fragment present in an example.
 * 「～」 is a slot, not text to search for; the remaining form is the
 * clickable grammar target.  Ambiguous/abstract formation labels are ignored.
 */
export const findGrammarFormRange = (text: string, point: Pick<GrammarPoint, "title" | "structure" | "connection">): GrammarFormRange | null => {
  const patterns = [point.title, point.connection ?? "", point.structure ?? ""];
  const candidates = new Set<string>();
  patterns.forEach((pattern) => {
    pattern
      .split(splitPattern)
      .map((part) => part.replace(PLACEHOLDERS, "").trim())
      .filter((part) => part.length >= 2 && !genericPart.test(part))
      .flatMap(inflectedVariants)
      .forEach((part) => candidates.add(part));
  });
  return [...candidates]
    .sort((left, right) => right.length - left.length)
    .map((candidate) => {
      const start = text.indexOf(candidate);
      return start < 0 ? null : { start, end: start + candidate.length, text: candidate };
    })
    .find((range): range is GrammarFormRange => Boolean(range)) ?? null;
};
