import titleData from "../data/grammar_title_furigana.json";
import { parseFurigana } from "./furigana-data";
import type { FuriganaAnnotation } from "../types/furigana";

type TitleFuriganaData = {
  version: string;
  source: string;
  entries: Record<string, unknown>;
  patterns?: Record<string, unknown>;
};

const data = titleData as TitleFuriganaData;
const entries = data.entries;
const patterns = data.patterns ?? {};
const cache = new Map<string, readonly FuriganaAnnotation[] | undefined>();
const patternCache = new Map<string, readonly FuriganaAnnotation[] | undefined>();

const read = (
  key: string,
  source: Record<string, unknown>,
  targetCache: Map<string, readonly FuriganaAnnotation[] | undefined>
) => {
  if (targetCache.has(key)) return targetCache.get(key);
  const parsed = parseFurigana(source[key]);
  const value = parsed ? Object.freeze(parsed) : undefined;
  targetCache.set(key, value);
  return value;
};

/** 语法标题的读音在构建期由 kuromoji 生成，运行时只查表，不加载词典。 */
export const getGrammarTitleFurigana = (grammarId: string): readonly FuriganaAnnotation[] | undefined => {
  return read(grammarId, entries, cache);
};

/** 数据库语法卡只有 pattern，没有 grammar.ts 的字符串 id；按句型查同一份注音。 */
export const getGrammarTitleFuriganaByPattern = (pattern: string): readonly FuriganaAnnotation[] | undefined => (
  read(pattern, patterns, patternCache)
);

/** 把删掉中文分类括号后的考题文本映射回原句型的注音区间。 */
export const projectFurigana = (
  sourceText: string,
  targetText: string,
  annotations: readonly FuriganaAnnotation[] | undefined
): FuriganaAnnotation[] | undefined => {
  if (!annotations) return undefined;
  if (sourceText === targetText) return [...annotations];
  const projected: FuriganaAnnotation[] = [];
  let searchFrom = 0;
  for (const annotation of annotations) {
    const base = sourceText.slice(annotation.start, annotation.start + annotation.length);
    const start = targetText.indexOf(base, searchFrom);
    if (!base || start < 0) return undefined;
    projected.push({ ...annotation, start });
    searchFrom = start + base.length;
  }
  return projected;
};
