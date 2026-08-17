import { describe, expect, it } from "vitest";
// The build script is plain ESM so it can run directly under Node; the
// runtime assertions below intentionally exercise that exact module.
// @ts-expect-error no browser bundle declaration is needed for the build-only module
import { buildTokenMetadata, mergeTokenBlocks, NON_STUDY_AUXILIARY_LEMMAS } from "../../scripts/token-bunsetsu.mjs";

const token = (surface_form: string, pos: string, pos_detail_1 = "", basic_form = surface_form) => ({
  surface_form,
  pos,
  pos_detail_1,
  basic_form
});

describe("baked bunsetsu token metadata", () => {
  it("合并用言和后续助动词/接続助詞", () => {
    const tokens = [
      token("過ごし", "動詞", "自立", "過ごす"), token("た", "助動詞", "", "た"),
      token("走っ", "動詞", "自立", "走る"), token("て", "助詞", "接続助詞", "て"), token("いる", "動詞", "非自立", "いる"),
      token("行か", "動詞", "自立", "行く"), token("なけれ", "助動詞", "", "ない"), token("ば", "助詞", "接続助詞", "ば")
    ];
    expect(mergeTokenBlocks(tokens).map((block: { surface: string }) => block.surface)).toEqual([
      "過ごした", "走っている", "行かなければ"
    ]);
  });

  it("把助词/助动词/标点标成不可点，并只保存稀疏原形", () => {
    const metadata = buildTokenMetadata([
      token("過ごし", "動詞", "自立", "過ごす"), token("た", "助動詞"),
      token("の", "助詞"), token("。", "記号"), token("家", "名詞", "一般", "家")
    ]);
    expect(metadata.lengths).toEqual([4, -1, -1, 1]);
    expect(metadata.lemmas).toEqual({ 0: "過ごす" });
  });

  it("为复合谓语保留词素链，而不是只留下第一个原形", () => {
    const metadata = buildTokenMetadata([
      token("許し", "動詞", "自立", "許す"),
      token("て", "助詞", "接続助詞", "て"),
      token("もらえ", "動詞", "非自立", "もらえる"),
      token("ない", "助動詞", "", "ない")
    ]);
    expect(metadata.lemmas[0]).toMatchObject({ lemma: "許す" });
    expect(metadata.lemmas[0].morphs).toHaveLength(4);
  });

  it("把文语敬语补助动词标为不可点，不混入学习词块", () => {
    expect(NON_STUDY_AUXILIARY_LEMMAS.has("たまう")).toBe(true);
    const blocks = mergeTokenBlocks([
      token("座り", "動詞", "自立", "座る"),
      token("たまえ", "動詞", "自立", "たまう")
    ]);
    expect(blocks.map((block: { surface: string; clickable: boolean }) => [block.surface, block.clickable])).toEqual([
      ["座り", true],
      ["たまえ", false]
    ]);
  });
});
