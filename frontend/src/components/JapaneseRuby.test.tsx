import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JapaneseRuby } from "./JapaneseRuby";

describe("JapaneseRuby tokenized rendering", () => {
  it("把烘焙的词块边界带到用户页面，同时保留词内注音", () => {
    const html = renderToStaticMarkup(
      <JapaneseRuby
        text="祖父母は家族。"
        furigana={[
          { start: 0, length: 3, reading: "そふぼ" },
          { start: 4, length: 2, reading: "かぞく" }
        ]}
        tokenLengths="3,1,2,1"
      />
    );

    expect(html.match(/class="jp-token"/g)).toHaveLength(4);
    expect(html).toContain('data-jp-token="祖父母"');
    expect(html).toContain('data-jp-token="家族"');
    expect(html).toContain("<rt>そふぼ</rt>");
    expect(html).toContain("<rt>かぞく</rt>");
  });

  it("负长度功能词只渲染为普通文本，不打开词典", () => {
    const html = renderToStaticMarkup(
      <JapaneseRuby text="過ごした。" tokenLengths="4,-1" tokenLemmas={'{"0":"過ごす"}'} />
    );
    expect(html).toContain('data-jp-token-clickable="true"');
    expect(html).toContain('data-jp-token-clickable="false"');
    expect(html).not.toContain('data-jp-token="。" role="button"');
  });

  it("语法例句中的目标形式优先包成语法点击目标", () => {
    const html = renderToStaticMarkup(
      <JapaneseRuby
        text="座りたまえ"
        tokenBoundaries={[
          { start: 0, end: 2, text: "座り", clickable: true, lemma: "座る" },
          { start: 2, end: 5, text: "たまえ", clickable: false, lemma: "たまう" }
        ]}
        grammarPoint={{
          title: "～たまえ",
          meaning: "请……",
          structure: "动词ます形＋たまえ",
          explanation: "用于上对下的命令或劝告。",
          connection: "动词ます形＋たまえ"
        }}
      />
    );

    expect(html).toContain('class="grammar-form-target"');
    expect(html).toContain("<span>た</span><span>ま</span><span>え</span>");
    expect(html).not.toContain('data-jp-token="たまえ"');
  });
});
