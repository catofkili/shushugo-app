import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrammarCard } from "./GrammarCard";
import type { GrammarQuizCard } from "../../lib/grammar-quiz";

const card: GrammarQuizCard = {
  id: 312,
  question: "～て済む／で済む",
  pattern: "～て済む／で済む",
  formation: "动词て形／名词で＋済む",
  attachment: "动词て形／名词で",
  meaning: "……就行了",
  exampleJp: "電話で知らせて済む問題ではありません。",
  exampleMeaning: "这不是打电话通知一下就能解决的问题。",
  exampleFurigana: [{ start: 0, length: 2, reading: "でんわ" }],
  exampleTokens: "",
  exampleLemmas: "",
  level: "N3",
  forgotCount: 0,
  rightCount: 0,
  isNew: true
};

describe("GrammarCard title furigana", () => {
  it("题面翻面后仍为句型汉字渲染注音", () => {
    const html = renderToStaticMarkup(
      <GrammarCard card={card} revealed onReveal={() => undefined} onAnswer={() => undefined} />
    );

    expect(html.match(/<rt>す<\/rt>/g)).toHaveLength(2);
  });

  it("删掉中文分类括号的题面也保留注音", () => {
    const html = renderToStaticMarkup(
      <GrammarCard
        card={{ ...card, pattern: "基数詞（基数词）", question: "基数詞", attachment: null }}
        revealed={false}
        onReveal={() => undefined}
        onAnswer={() => undefined}
      />
    );

    expect(html).toContain("<rt>きすうし</rt>");
  });
});
