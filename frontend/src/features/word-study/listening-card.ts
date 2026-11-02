import type { WordCard } from "../../types/vocabulary";

export function isListeningReverseCard(card: Pick<WordCard, "jlptLevel" | "kanji" | "kana" | "meaning" | "kanjiComponents">): boolean {
  if (card.jlptLevel !== "N1" || card.kanji === card.kana || !/^[\p{Script=Han}々]{2,}$/u.test(card.kanji)) return false;

  // 组件按字去重，必须按原词逐字还原；々 没有组件，原样保留。
  const simplifiedByChar = new Map(card.kanjiComponents.map(({ char, simplified }) => [char, simplified]));
  const simplified = [...card.kanji].map(char => simplifiedByChar.get(char) ?? char).join("");
  return card.meaning.split(/[；;，,、/／]/).some(part => {
    const meaning = part.trim();
    return meaning === simplified || meaning.replace(/的$/, "") === simplified;
  });
}
