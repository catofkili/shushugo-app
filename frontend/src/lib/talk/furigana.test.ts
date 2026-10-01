import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import annotations from "../../data/talk_furigana.json";
import type { FuriganaAnnotation } from "../../types/furigana";
import { loadTalkContent, setTalkContentForTest, talkContentLoaded, talkFurigana } from "./content";

const table: Record<string, FuriganaAnnotation[]> = annotations;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const overrides = JSON.parse(readFileSync(`${root}scripts/talk-furigana-overrides.json`, "utf8")) as Record<string, { base: string; reading: string }[]>;

describe("构建期会话注音", () => {
  it("与当前内容、提示、人工覆盖逐项一致，内容变更忘记重跑会失败（只核验，不写文件）", () => {
    expect(execFileSync(process.execPath, ["scripts/build-talk-furigana.mjs", "--check"], { cwd: root, encoding: "utf8" })).toContain("verification passed");
  });

  it("所有汉字都有非空注音，假名不注；UTF-16 区间有序且不重叠", () => {
    for (const [sentence, spans] of Object.entries(table)) {
      let end = 0;
      for (const span of spans) {
        expect(span.start).toBeGreaterThanOrEqual(end);
        end = span.start + span.length;
        expect(end).toBeLessThanOrEqual(sentence.length);
        expect(sentence.slice(span.start, end)).toMatch(/^[\u3400-\u9fff々〇]+$/u);
        expect(span.reading).toMatch(/^[ぁ-んー]+$/u);
      }
      for (let at = 0; at < sentence.length; at++) if (/[\u3400-\u9fff々〇]/u.test(sentence[at])) {
        expect(spans.some((span) => span.start <= at && at < span.start + span.length), sentence).toBe(true);
      }
    }
  });

  it("覆盖片段跨分词边界仍生效（含数字量词、日期、复合词和送假名）", () => {
    const checked = new Set<string>();
    for (const [sentence, rules] of Object.entries(overrides)) for (const { base, reading } of rules) {
      let start = sentence.indexOf(base);
      while (start >= 0) {
        let cursor = start;
        let actual = "";
        for (const span of table[sentence].filter((span) => span.start >= start && span.start + span.length <= start + base.length)) {
          actual += sentence.slice(cursor, span.start) + span.reading;
          cursor = span.start + span.length;
        }
        actual += sentence.slice(cursor, start + base.length);
        expect(actual, `${sentence} / ${base}`).toBe(reading);
        checked.add(base);
        start = sentence.indexOf(base, start + base.length);
      }
    }
    for (const base of ["十分", "二十分", "三十分", "十五分", "五分", "一時間", "十時", "午後三時", "一つ", "二つ", "一人分", "二人分", "大人二人", "二枚", "一膳", "一回", "一度", "一日", "替え玉", "大盛り", "普通盛り", "素泊まり", "各駅停車", "普通車", "何番線", "初診", "一言", "上手"]) expect(checked.has(base), base).toBe(true);
  });

  it("内容和注音一起懒加载；未知句子原样显示所需的空数组", async () => {
    setTalkContentForTest(null);
    expect(talkContentLoaded()).toBe(false);
    expect(talkFurigana("替え玉は百五十円です。")).toEqual([]);
    await loadTalkContent();
    expect(talkContentLoaded()).toBe(true);
    expect(talkFurigana("替え玉は百五十円です。")).toEqual(table["替え玉は百五十円です。"]);
    expect(talkFurigana("不存在的句子")).toEqual([]);
    setTalkContentForTest(null);
  });
});
