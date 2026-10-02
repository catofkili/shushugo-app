import type { SpellingCard } from "../../lib/spelling";

export const nextSpellingCard = (
  pick: (day?: string, excluded?: Set<string>) => number | null,
  cardFor: (wordId: number) => SpellingCard | null
): SpellingCard | null => {
  const excluded = new Set<string>();
  for (;;) {
    const wordId = pick(undefined, excluded);
    if (wordId === null) return null;
    const key = String(wordId);
    // 坏清单或未遵守 excluded 的实现不能让页面卡在无限循环里。
    if (excluded.has(key)) throw new Error("拼写清单重复返回无法打开的词");
    const card = cardFor(wordId);
    if (card) return card;
    excluded.add(key);
  }
};
