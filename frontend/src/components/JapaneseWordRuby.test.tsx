import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { loadKanjiReadings } from "../lib/furigana";
import { JapaneseWordRuby } from "./JapaneseWordRuby";

beforeAll(async () => {
  await loadKanjiReadings();
});

describe("JapaneseWordRuby", () => {
  it("在疑难辨析词形的汉字上方显示对应假名", () => {
    const html = renderToStaticMarkup(
      <JapaneseWordRuby surface="公園" reading="こうえん" className="cf-member-word" />
    );

    expect(html).toContain("<ruby class=\"jp-ruby\">公<rt>こう</rt></ruby>");
    expect(html).toContain("<ruby class=\"jp-ruby\">園<rt>えん</rt></ruby>");
  });

  it("纯假名词不额外生成空的 ruby", () => {
    const html = renderToStaticMarkup(
      <JapaneseWordRuby surface="こうえん" reading="こうえん" className="cf-member-word" />
    );

    expect(html).toContain("こうえん");
    expect(html).not.toContain("<rt>");
  });
});
