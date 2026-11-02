import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrammarCard } from "./GrammarCard";
import type { GrammarQuizCard } from "../../lib/grammar-quiz";
import { grammarPoints } from "../../data/grammar";
import { JapaneseRuby } from "../../components/JapaneseRuby";
import { getGrammarTitleFurigana } from "../../lib/grammar-title-furigana";

const card: GrammarQuizCard = {
  id: 312,
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

  it("普通考题翻面前也保留标题注音", () => {
    const html = renderToStaticMarkup(
      <GrammarCard
        card={{ ...card, attachment: null }}
        revealed={false}
        onReveal={() => undefined}
        onAnswer={() => undefined}
      />
    );

    expect(html).toContain("<rt>す</rt>");
  });

  it.each(["pdf-n5-015", "pdf-n5-016"])("读音题 %s 的考题、混合首学卡及列表标题均不露注音", (id) => {
    const point = grammarPoints.find((point) => point.id === id)!;
    for (const isNew of [false, true]) {
      const html = renderToStaticMarkup(
        <GrammarCard
          card={{ ...card, pattern: point.title, attachment: null, isNew, meaning: point.meaning }}
          revealed={false}
          onReveal={() => undefined}
          onAnswer={() => undefined}
        />
      );
      expect(html).not.toContain("<rt>");
      expect(html).not.toContain("いっぽん");
      expect(html).not.toContain("ついたち");
      const revealed = renderToStaticMarkup(
        <GrammarCard card={{ ...card, pattern: point.title, meaning: point.meaning }} revealed onReveal={() => undefined} onAnswer={() => undefined} />
      );
      expect(revealed).toContain(point.meaning);
    }
    const title = renderToStaticMarkup(<JapaneseRuby text={point.title} furigana={getGrammarTitleFurigana(id)} />);
    expect(title).not.toContain("<rt>");
  });
});
