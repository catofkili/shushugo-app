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

/** 按 grammar_points 的 pattern 取抓手（语法考题卡走这条）。 */
export const grammarKeyPoint = (pattern: string): string => points[pattern] ?? "";

/** 按 grammar.ts 的语法点取抓手（辞典、语法库、沉浸阅读走这条）。 */
export const grammarKeyPointFor = (point: { id: string; title: string }): string =>
  grammarKeyPoint(aliases[point.id] ?? point.title);
