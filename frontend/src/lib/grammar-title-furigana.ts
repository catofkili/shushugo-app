import titleData from "../data/grammar_title_furigana.json";
import { parseFurigana } from "./furigana-data";
import type { FuriganaAnnotation } from "../types/furigana";

type TitleFuriganaData = {
  version: string;
  source: string;
  entries: Record<string, unknown>;
};

const entries = (titleData as TitleFuriganaData).entries;
const cache = new Map<string, readonly FuriganaAnnotation[] | undefined>();

/** 语法标题的读音在构建期由 kuromoji 生成，运行时只查表，不加载词典。 */
export const getGrammarTitleFurigana = (grammarId: string): readonly FuriganaAnnotation[] | undefined => {
  if (cache.has(grammarId)) return cache.get(grammarId);
  const parsed = parseFurigana(entries[grammarId]);
  const value = parsed ? Object.freeze(parsed) : undefined;
  cache.set(grammarId, value);
  return value;
};
