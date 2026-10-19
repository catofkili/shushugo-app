import data from "../data/grammar_key_points.json";

/**
 * 每条语法一句「抓手」：≤20 字，说这条最容易错、最该记的那一点，
 * **不是复述释义**。741 条全部人工写，判据是「删掉之后这条卡还剩什么」。
 *
 * ⚠️ **键是 grammar_points 的 `pattern`，不是 grammar.ts 的字符串 id。**
 * 语法考题卡（`GrammarCard`）拿到的只有 DB 那一行的 pattern，而学习页拿到的是
 * grammar.ts 的 point —— 用 pattern 当键两边共用同一份，考题卡也就不必为了查
 * 一句抓手把 1.5 MB 的 grammar.ts 拉进自己的包。重名的第二条 pattern 带
 * `（N4-2）` 后缀（口径见 build-furigana.mjs 的 syncGrammarDbContent），
 * `aliases` 只装那 14 条的 id → pattern，其余 pattern 就等于 title。
 *
 * ⚠️ **故意不进数据库、也不进 grammar_seed。** 它是内容不是用户状态；加一列就要动
 * `ensureGrammarSeed` 那条「升版本会掉条目、会删用户进度」的迁移路径
 * （见 CLAUDE.md 里那一节），而这份 JSON 换一版只是换个文件，没有迁移。
 */
const points = data.points as Record<string, string>;
const aliases = data.aliases as Record<string, string>;
const kanji = data.kanji as Record<string, unknown>;

/** 按 grammar_points 的 pattern 取抓手（语法考题卡走这条）。 */
// typeof 守门：小程序里这份 JSON 是懒代理，没加载时取到的是代理对象而不是 undefined，
// 交给 JSX 渲染会整页崩掉（2026-10-09 真机，混合学习语法插播翻面没反应）。
export const grammarKeyPoint = (pattern: string): string => {
  const point = points[pattern];
  return typeof point === "string" ? point : "";
};

/** 按 grammar.ts 的语法点取抓手（辞典、语法库、沉浸阅读走这条）。 */
export const grammarKeyPointFor = (point: { id: string; title: string }): string =>
  grammarKeyPoint(aliases[point.id] ?? point.title);

/** 汉字只作揭晓后的记忆提示，不替换题面；未加载的懒代理也必须返回 null。 */
export const grammarKanjiHint = (pattern: string): { kana: string; kanji: string; hook: string } | null => {
  const hint = kanji[pattern];
  if (!Array.isArray(hint) || hint.length !== 3) return null;
  const [kana, kanjiText, hook] = hint;
  if (typeof kana !== "string" || typeof kanjiText !== "string" || typeof hook !== "string") return null;
  return { kana, kanji: kanjiText, hook };
};

export const grammarKanjiHintFor = (point: { id: string; title: string }) => {
  const alias = aliases[point.id];
  return grammarKanjiHint(typeof alias === "string" ? alias : point.title);
};
