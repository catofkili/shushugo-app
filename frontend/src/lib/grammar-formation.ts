/**
 * 语法卡上的「接续」怎么拆行。
 *
 * `connection` / `structure` 的格式基本是 `前缀＋句型`（「名词の／动词ている＋間」）。
 * 但有 55 条其实是**两条独立的接续规则**用 ／ 连着写的：
 *   ～てください／ないでください → 動詞て形＋ください ／ 動詞ない形＋ないでください
 *   ～うちは／ないうちに        → 动词ない形＋ないうちに ／ 名词の・动词ている＋うちは
 * 这种卡上下各摆一条，一条对一个形式，比挤成一行清楚得多。
 *
 * ⚠️ **不能见 ／ 就拆**：731 条里 405 条带 ／，绝大多数是句型自己的选项
 * （「名詞1＋は＋名詞2＋です／ではありません」），拆开就成了半句话。
 * 判据是 **／ 两边各自都要有 ＋**——有 ＋ 才说明那一段是完整的「什么形＋什么」。
 * 实测这条判据挑出 55 条，逐条看过都是真的两条规则。
 */
export const splitFormationRules = (formation: string | undefined | null): string[] => {
  const text = String(formation ?? "").trim();
  if (!text) return [];
  const index = text.indexOf("／");
  if (index <= 0) return [text];
  const head = text.slice(0, index).trim();
  const tail = text.slice(index + 1).trim();
  if (!head.includes("＋") || !tail.includes("＋")) return [text];
  return [head, tail];
};
