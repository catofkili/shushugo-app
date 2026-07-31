import { describe, expect, it } from "vitest";
import {
  pronunciationAudioName,
  pronunciationAudioUrl,
  pronunciationReading,
  speechText
} from "./speech";

describe("pronunciationReading", () => {
  it("给 VOICEVOX 保留词库原始假名,不把 ゆしゅつ 变成会误解析的全片假名", () => {
    expect(pronunciationReading("ゆしゅつ")).toBe("ゆしゅつ");
    expect(pronunciationReading("カメラ")).toBe("カメラ");
    expect(pronunciationReading("けしゴム")).toBe("けしゴム");
  });

  it("仍会剥掉词库里的波浪号和夹注音", () => {
    expect(pronunciationReading("〜だす")).toBe("だす");
    expect(pronunciationReading("ぬ[濡]れる")).toBe("ぬれる");
  });
});

describe("speechText", () => {
  it("一律转片假名,引擎再怎么切词音素都不变", () => {
    // 大体 曾被读成「da itai」:引擎把 だいたい 切成 だ|いたい
    expect(speechText("大体", "だいたい")).toBe("ダイタイ");
    // 灰皿 曾被读成「wa izara」:は 被当成助词
    expect(speechText("灰皿", "はいざら")).toBe("ハイザラ");
    expect(speechText("部屋", "へや")).toBe("ヘヤ");
    expect(speechText("出発", "しゅっぱつ")).toBe("シュッパツ");
    expect(speechText("東京", "とうきょう")).toBe("トウキョウ");
  });

  it("以卡片假名为准,不给引擎挑读音的机会", () => {
    // 誠 曾因为喂汉字被读成音读 セイ
    expect(speechText("誠", "まこと")).toBe("マコト");
    expect(speechText("角", "かど")).toBe("カド");
    expect(speechText("角", "かく")).toBe("カク");
    expect(speechText("開く", "あく")).toBe("アク");
    expect(speechText("開く", "ひらく")).toBe("ヒラク");
  });

  it("词尾真·助词改写成实际读音(表记也以该假名收尾才算)", () => {
    expect(speechText("こんにちは", "こんにちは")).toBe("コンニチワ");
    expect(speechText("実は", "じつは")).toBe("ジツワ");
    expect(speechText("または", "または")).toBe("マタワ");
    expect(speechText("中には", "なかには")).toBe("ナカニワ");
    expect(speechText("それを", "それを")).toBe("ソレオ");
  });

  it("词尾的 は 属于词本身时不能改写", () => {
    expect(speechText("母", "はは")).toBe("ハハ");
    expect(speechText("木の葉", "このは")).toBe("コノハ");
    expect(speechText("流派", "りゅうは")).toBe("リュウハ");
    expect(speechText("歯", "は")).toBe("ハ");
  });

  it("片假名词原样不动", () => {
    expect(speechText("coffee", "コーヒー")).toBe("コーヒー");
    expect(speechText("消しゴム", "けしゴム")).toBe("ケシゴム");
  });

  it("剥掉词库里的波浪号和夹注音,免得被念出来", () => {
    expect(speechText("〜出す", "〜だす")).toBe("ダス");
    expect(speechText("濡[ぬ]れる", "ぬ[濡]れる")).toBe("ヌレル");
  });

  it("音频文件名是纯 ASCII 哈希,躲开 URL 解码和 Unicode 归一化", () => {
    expect(pronunciationAudioName("灰皿", "はいざら")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("按词建文件而不是按读音——箸和橋读音都是ハシ,但重音不同,音频不能共用", () => {
    expect(pronunciationAudioName("箸", "はし")).not.toBe(pronunciationAudioName("橋", "はし"));
    // 同一个词永远算出同一个名字(脚本和运行时靠这个对上)
    expect(pronunciationAudioName("灰皿", "はいざら")).toBe(pronunciationAudioName("灰皿", "はいざら"));
  });

  it("没生成过音频库时不给地址,调用方直接走系统语音,不发无谓请求", () => {
    expect(pronunciationAudioUrl("灰皿", "はいざら")).toBeNull();
  });
});
