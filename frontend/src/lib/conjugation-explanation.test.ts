import { describe, expect, it } from "vitest";
import {
  describeConjugation,
  isKnownVerbPair,
  isPotentialReadingCompatible,
  potentialDictionaryCandidates
} from "./conjugation-explanation";

const explain = (
  surface: string,
  lemma: string,
  verbType = "godan",
  dictionaryForm = lemma,
  pos = "动词"
) => describeConjugation({ surface, lemma, dictionaryForm, verbType, pos });

describe("sentence token conjugation explanations", () => {
  it("说明五段动词的た形", () => {
    expect(explain("過ごした", "過ごす")).toEqual({
      label: "过去／完成（た形）",
      rule: "過ごす是五段动词：词尾「す」按音便规则变为「した」。"
    });
  });

  it("说明ている、否定条件和敬体过去", () => {
    expect(explain("走っている", "走る")?.label).toBe("ている形（非过去）");
    expect(explain("行かなければ", "行く")?.label).toBe("否定条件形");
    expect(explain("買いました", "買う")?.label).toBe("敬体过去形");
  });

  it("说明一段动词和形容词规则", () => {
    expect(explain("食べなかった", "食べる", "ichidan")?.rule).toContain("去掉「る」");
    expect(explain("大きかった", "大きい", "", "大きい", "い形容词")).toEqual({
      label: "形容词过去形",
      rule: "大きい去掉「い」，接「かった」。"
    });
  });

  it("只在原查询失败且命中词典形时判定可能形", () => {
    expect(potentialDictionaryCandidates("使える")).toContain("使う");
    expect(potentialDictionaryCandidates("話せる")).toContain("話す");
    expect(explain("使える", "使える", "godan", "使う")?.label).toBe("可能形（推测）");
    expect(explain("使えます", "使える", "godan", "使う")?.label).toBe("可能形（推测）＋敬体");
    expect(explain("使えます", "使える", "godan", "使う")?.rule).toContain("推测为「使う」的可能形");
    expect(describeConjugation({
      surface: "使える",
      lemma: "使える",
      dictionaryForm: "使う",
      verbType: "godan",
      pos: "动词",
      morphs: [{ surface: "使え", lemma: "使う", pos: "動詞", detail: "自立", conjugatedForm: "可能形" }]
    })?.label).toBe("可能形");
    expect(describeConjugation({
      surface: "使えます",
      lemma: "使える",
      dictionaryForm: "使う",
      verbType: "godan",
      pos: "动词",
      morphs: [{ surface: "使え", lemma: "使える", pos: "動詞", detail: "自立", conjugatedType: "一段", conjugatedForm: "連用形" }]
    })?.label).toBe("可能形＋敬体");
    expect(explain("見える", "見える", "ichidan", "見える")).toBeNull();
  });

  it("用假名 lemma 重构汉字词条的表记ゆれ", () => {
    expect(describeConjugation({
      surface: "かかります",
      lemma: "かかる",
      dictionaryForm: "掛かる",
      verbType: "godan",
      pos: "动词"
    })?.label).toBe("敬体非过去形");
    expect(describeConjugation({
      surface: "いただけます",
      lemma: "いただける",
      dictionaryForm: "頂く",
      verbType: "godan",
      pos: "动词",
      dictionaryReading: "いただく"
    })?.label).toBe("可能形（推测）＋敬体");
  });

  it("自他动词对不能被可能形还原越过", () => {
    expect(isKnownVerbPair("開ける", "開く")).toBe(true);
    expect(isKnownVerbPair("空ける", "空く", "あける", "あく")).toBe(true);
    expect(isPotentialReadingCompatible("あける", "あく", "godan")).toBe(true);
    expect(isPotentialReadingCompatible("あける", "すく", "godan")).toBe(false);
    expect(explain("開ける", "開ける", "godan", "開く")).toBeNull();
  });

  it("名词谓语不会被末尾的「た」误判为动词た形", () => {
    expect(explain("学生でした", "学生", "", "学生", "名词")?.label).toBe("名词谓语・敬体过去");
  });

  it("无法仅靠形态区分可能和受身时明确提示语境歧义", () => {
    const morphs = [
      { surface: "食べ", lemma: "食べる", pos: "動詞", detail: "自立", conjugatedForm: "未然形" },
      { surface: "られる", lemma: "られる", pos: "動詞", detail: "接尾", conjugatedForm: "基本形" }
    ];
    const result = describeConjugation({
      surface: "食べられる",
      lemma: "食べる",
      dictionaryForm: "食べる",
      verbType: "ichidan",
      pos: "动词",
      morphs
    });
    expect(result?.label).toBe("复合词形");
    expect(result?.rule).toContain("需要结合整句语境判断");
    expect(result?.steps?.map((step) => step.label)).toEqual(["可能形／受身形"]);

    const seen = describeConjugation({
      surface: "見られる",
      lemma: "見る",
      dictionaryForm: "見る",
      verbType: "ichidan",
      pos: "动词",
      morphs: [
        { surface: "見", lemma: "見る", pos: "動詞", detail: "自立", conjugatedForm: "未然形" },
        { surface: "られる", lemma: "られる", pos: "動詞", detail: "接尾", conjugatedForm: "基本形" }
      ]
    });
    expect(seen?.label).toBe("复合词形");
  });

  it("复合谓语按词素链分步解释，并拒绝只靠词尾猜错的形态", () => {
    const result = describeConjugation({
      surface: "許してもらえない",
      lemma: "許す",
      dictionaryForm: "許す",
      verbType: "godan",
      pos: "动词",
      morphs: [
        { surface: "許し", lemma: "許す", pos: "動詞", detail: "自立" },
        { surface: "て", lemma: "て", pos: "助詞", detail: "接続助詞" },
        { surface: "もらえ", lemma: "もらえる", pos: "動詞", detail: "非自立" },
        { surface: "ない", lemma: "ない", pos: "助動詞", detail: "" }
      ]
    });
    expect(result?.steps?.map((step) => step.label)).toEqual(["て形", "可能形", "否定形"]);
    expect(result?.steps?.[2]?.to).toBe("許してもらえない");
    expect(describeConjugation({
      surface: "食べて四",
      lemma: "食べる",
      dictionaryForm: "食べる",
      verbType: "ichidan",
      pos: "动词",
      morphs: [
        { surface: "食べ", lemma: "食べる", pos: "動詞", detail: "自立" },
        { surface: "て", lemma: "て", pos: "助詞", detail: "接続助詞" },
        { surface: "四", lemma: "四", pos: "名詞", detail: "一般" }
      ]
    })).toBeNull();
  });
});
