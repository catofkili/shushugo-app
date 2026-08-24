import { describe, expect, it } from "vitest";
import type { WordCard } from "../../types/vocabulary";
import {
  answerReadingText,
  cardLabel,
  concealedReadingParts,
  formatDuration,
  isLoanwordSourceCard,
  kanaToRomaji,
  monthDays,
  moraCount,
  primaryAnswerText,
  secondaryAnswerText
} from "./word-study-utils";
import { honorificLabel, promptMeaning, questionMeaning } from "../../lib/models/word-card";

const card = (patch: Partial<WordCard>): WordCard => ({
  id: 1,
  meaning: "",
  primaryMeaning: "",
  promptMeaning: "",
  kana: "すし",
  kanji: "寿司",
  pos: "名词",
  jlptLevel: "N5",
  importance: 3,
  importanceScore: 3,
  isFavorite: false,
  note: "",
  example: { jp: "", meaning: "" },
  kanjiComponents: [],
  conjugations: [],
  confusions: [],
  ...patch
});

describe("word-study-utils", () => {
  it("uses kana as the primary answer for loanwords stored with an ASCII source", () => {
    const loanword = card({ kanji: "coffee", kana: "コーヒー" });

    expect(isLoanwordSourceCard(loanword)).toBe(true);
    expect(primaryAnswerText(loanword)).toBe("コーヒー");
    expect(secondaryAnswerText(loanword)).toBe("coffee");
    expect(cardLabel(loanword)).toBe("コーヒー / coffee");
  });

  it("keeps kanji first for ordinary Japanese cards", () => {
    const japaneseCard = card({ kanji: "学校", kana: "がっこう" });

    expect(isLoanwordSourceCard(japaneseCard)).toBe(false);
    expect(primaryAnswerText(japaneseCard)).toBe("学校");
    expect(secondaryAnswerText(japaneseCard)).toBe("がっこう");
  });

  it("uses the reviewed natural spelling on classic cards", () => {
    const kanaPreferred = card({ kanji: "殆ど", kana: "ほとんど" });
    expect(primaryAnswerText(kanaPreferred)).toBe("ほとんど");
    expect(secondaryAnswerText(kanaPreferred)).toBe("殆ど");
    expect(answerReadingText(kanaPreferred)).toBe("");

    // 标准表记修正只用于「同一个词的异体写法」：剝→剥、片づける→片付ける 这类
    const corrected = card({ kanji: "剝がす", kana: "はがす" });
    expect(primaryAnswerText(corrected)).toBe("剥がす");
    expect(secondaryAnswerText(corrected)).toBe("はがす");
    expect(answerReadingText(corrected)).toBe("はがす");

    // 但**不能改写成另一个词**：趣旨(#8325) 和 主旨(#9071) 是词库里两个独立词条，
    // 改写会让两行显示成同一个词形，等于把 主旨 这个词改名。木/樹 同理。
    const distinct = card({ kanji: "主旨", kana: "しゅし" });
    expect(primaryAnswerText(distinct)).toBe("主旨");
    const tree = card({ kanji: "樹", kana: "き" });
    expect(primaryAnswerText(tree)).toBe("樹");
  });

  it("shows the Japanese reading for mixed kanji and loanword cards", () => {
    const mixedCard = card({
      kanji: "生産コスト",
      kana: "せいさんこすと",
      englishOrigin: "cost"
    });

    expect(answerReadingText(mixedCard)).toBe("せいさんこすと");
  });

  it("does not show the English source as a Japanese reading", () => {
    const loanword = card({ kanji: "coffee", kana: "コーヒー", englishOrigin: "coffee" });

    expect(answerReadingText(loanword)).toBe("");
  });

  it("汉字读音题只露出表记中原本的假名", () => {
    expect(concealedReadingParts([
      { text: "食", reading: "た", isKanji: true },
      { text: "べる", reading: "べる", isKanji: false }
    ])).toEqual([
      { text: "", hidden: true },
      { text: "べる", hidden: false }
    ]);

    expect(concealedReadingParts([
      { text: "生", reading: "せい", isKanji: true },
      { text: "産", reading: "さん", isKanji: true },
      { text: "コスト", reading: "こすと", isKanji: false }
    ])).toEqual([
      { text: "", hidden: true },
      { text: "", hidden: true },
      { text: "コスト", hidden: false }
    ]);
  });

  it("读音切分未就绪或熟字训无法对齐时整条隐藏，不闪完整答案", () => {
    expect(concealedReadingParts(null)).toEqual([{ text: "", hidden: true }]);
  });

  it("romanizes small kana and doubled consonants", () => {
    expect(kanaToRomaji("きゃっこう")).toBe("kya kko u");
  });

  it("formats short and long study durations", () => {
    expect(formatDuration(-1)).toBe("0秒");
    expect(formatDuration(65)).toBe("1分05秒");
    expect(formatDuration(3661)).toBe("1小时01分");
  });

  it("keeps short letter+CJK prompts such as T恤", () => {
    expect(promptMeaning("T恤", 2276, "Ｔシャツ")).toBe("T恤");
    expect(promptMeaning("卡拉OK，KTV", 938, "カラオケ")).toBe("卡拉OK");
    expect(promptMeaning("A型血", 1, "")).toBe("A型血");
    expect(promptMeaning("SNS账号", 1, "")).toBe("SNS账号");
    expect(promptMeaning("shirt 衬衫", 287, "shirt")).toBe("衬衫");
    expect(promptMeaning("digitalcamera数码相机", 2050, "デジカメ")).toBe("数码相机");
    expect(promptMeaning("court球场；coat上衣", 2034, "コート")).toBe("球场");
  });

  it("keeps normal acronyms but removes English glosses from question meanings", () => {
    expect(questionMeaning("卡拉OK，KTV")).toBe("卡拉OK，KTV");
    expect(questionMeaning("T恤")).toBe("T恤");
    expect(questionMeaning("department store便利店")).toBe("便利店");
    expect(questionMeaning("court球场；coat上衣")).toBe("球场；上衣");
  });

  it("uses the reviewed question meaning by Japanese word pair", () => {
    expect(questionMeaning("订购；要求", "注文", "ちゅうもん")).toBe("点菜；订购");
    expect(promptMeaning("订购；要求", 3018, "注文", "ちゅうもん")).toBe("点菜；订购");
    expect(questionMeaning("学校", "学校", "がっこう")).toBe("学校");
    expect(questionMeaning("一天", "一日", "いちにち")).toBe("一天");
    expect(questionMeaning("一日", "一日", "ついたち")).toBe("一号；每月一日");
  });

  it("removes source-word abbreviation notes instead of leaving 「」的省略 husks", () => {
    // 新种子库形态:英文 + 片假名源词注记(片假名会漏答案)
    expect(questionMeaning("手帕。handkerchief「ハンカチーフ」的省略")).toBe("手帕。");
    // 旧设备库形态:英文在括号内,剥离后只剩空括号
    expect(questionMeaning("手帕。「handkerchief」的省略")).toBe("手帕。");
    expect(questionMeaning("超市「スーパーマーケット」的省略语；super超，上，高级，超级")).toBe("超市；超，上，高级，超级");
    expect(questionMeaning("（宠物用）砂盆；toiletトイレット的缩略，厕所，化妆室")).toBe("（宠物用）砂盆；厕所，化妆室");
    expect(questionMeaning("钓鱼；「釣り銭」的省略，找回的钱")).toBe("钓鱼；找回的钱");
    // 括号内是纯中文时是有效释义,保留
    expect(questionMeaning("月；月，“星期一”的省略")).toBe("月；月，“星期一”的省略");
    // 正文里的"省略"词义本身不受影响
    expect(questionMeaning("省略，从简")).toBe("省略，从简");
  });

  it("labels honorific and humble words without tagging ordinary respect meanings", () => {
    expect(honorificLabel("吃喝（对外敬语）")).toBe("敬语");
    expect(honorificLabel("（「言う」の謙譲語）说，讲")).toBe("谦语");
    expect(honorificLabel("（对自己公司的谦称）敝公司")).toBe("谦称");
    expect(honorificLabel("尊敬，敬仰")).toBe("");
    expect(honorificLabel("谦虚")).toBe("");
  });

  it("labels known honorific word forms whose meanings are plain translations", () => {
    expect(honorificLabel("吃，喝；得到", "頂く")).toBe("谦语");
    expect(honorificLabel("来；去；在", "いらっしゃる")).toBe("敬语");
    expect(honorificLabel("做", "なさる")).toBe("敬语");
    expect(honorificLabel("给予，赐予", "くださる")).toBe("敬语");
    expect(honorificLabel("在", "おる")).toBe("谦语");
    expect(honorificLabel("请教，打听；拜访", "伺う")).toBe("谦语");
    // 同音普通词不能被误标
    expect(honorificLabel("折，折断", "折る")).toBe("");
    expect(honorificLabel("织，编织", "織る")).toBe("");
    // 释义里已有标注的走原逻辑
    expect(honorificLabel("吃喝（对外敬语）", "召し上がる")).toBe("敬语");
  });

  it("builds a complete calendar month", () => {
    const calendar = monthDays("2026-06-19");

    expect(calendar.title).toBe("2026年6月");
    expect(calendar.cells).toHaveLength(31);
    expect(calendar.cells[0]).toBeNull();
    expect(calendar.cells[1]).toEqual({ day: 1, date: "2026-06-01" });
    expect(calendar.cells[30]).toEqual({ day: 30, date: "2026-06-30" });
  });
});

describe("拍数提示", () => {
  it("拗音并进前一拍，促音/拨音/长音各算一拍", () => {
    expect(moraCount("しゅくだい")).toBe(4);   // しゅ・く・だ・い
    expect(moraCount("コーヒー")).toBe(4);     // コ・ー・ヒ・ー
    expect(moraCount("きっぷ")).toBe(3);       // き・っ・ぷ
    expect(moraCount("しんぶん")).toBe(4);
    expect(moraCount("フェア")).toBe(2);       // フェ・ア
  });

  it("题面撞车的词靠拍数分开", () => {
    // 「警察」这行中文下面挂着三个词，拍数把 警察官 摘出去
    expect(moraCount("けいさつ")).toBe(4);
    expect(moraCount("けいさつかん")).toBe(6);
  });

  it("～ 和括号不是读音的一部分", () => {
    expect(moraCount("～する")).toBe(2);
  });
});
