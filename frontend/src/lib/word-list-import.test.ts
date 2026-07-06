import { describe, expect, it } from "vitest";
import { parseExternalWordListText, previewExternalWordList } from "./word-list-import";

describe("external word list import parsing", () => {
  it("parses headed TSV exports with memory columns", () => {
    const text = [
      "单词\t假名\t释义\t做题分数\t复习次数\t最后复习",
      "曖昧\tあいまい\t暧昧；含糊\t32\t5\t2026-06-30",
      "諦める\tあきらめる\t放弃\t80\t3\t2026-07-01"
    ].join("\n");

    const preview = previewExternalWordList(text);

    expect(preview.validRows).toBe(2);
    expect(preview.samples[0]).toMatchObject({
      kanji: "曖昧",
      kana: "あいまい",
      meaning: "暧昧；含糊",
      seenCount: 5,
      lastSeenOn: "2026-06-30"
    });
    expect(preview.samples[0].memoryScore).toBeLessThan(0);
    expect(preview.samples[1].memoryScore).toBeGreaterThan(0);
  });

  it("parses JSON arrays from complete list exports", () => {
    const records = parseExternalWordListText(JSON.stringify({
      words: [
        { title: "確認", reading: "かくにん", translation: "确认", memory: "忘记" },
        { title: "提出", reading: "ていしゅつ", translation: "提交", memory: "已掌握" }
      ]
    }));

    expect(records).toHaveLength(2);
    const preview = previewExternalWordList(JSON.stringify({ words: records }));
    expect(preview.validRows).toBe(2);
    expect(preview.samples[0].memoryScore).toBeLessThan(0);
    expect(preview.samples[1].memoryScore).toBeGreaterThan(0);
  });

  it("parses MOJi-style cloud JSON fields", () => {
    const preview = previewExternalWordList(JSON.stringify({
      data: [
        { spell: "確認", pron: "かくにん", briefInfo: "确认", score: 42, qCnt: 7, qWrCnt: 2 }
      ]
    }));

    expect(preview.validRows).toBe(1);
    expect(preview.samples[0]).toMatchObject({
      kanji: "確認",
      kana: "かくにん",
      meaning: "确认",
      seenCount: 7,
      forgotCount: 2
    });
  });

  it("deduplicates repeated word and reading pairs", () => {
    const preview = previewExternalWordList("単語,かな,意味\n勉強,べんきょう,学习\n勉強,べんきょう,学习");

    expect(preview.validRows).toBe(1);
    expect(preview.duplicateRows).toBe(1);
  });
});
