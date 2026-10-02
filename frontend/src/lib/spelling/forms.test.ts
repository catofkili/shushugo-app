import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cleanWordSurface,
  isLoanwordSourceSurface,
  preferredWordSurface
} from "../orthography";
import { SPELLING_FORMS_VERSION, spellingTargetForWord } from "./forms";

interface WordRow {
  id: number;
  kanji: string;
  kana: string;
}

const hanPattern = /\p{Script=Han}/u;
const hiraganaPattern = /^[\u3041-\u3096\u309d-\u309f]+$/u;
const katakanaPattern = /[\u30a0-\u30ffー]+/u;
const ignoredMarks = /[〜～~・\s]/gu;
const codePointOrder = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const readData = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

let words: WordRow[] = [];

beforeAll(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(
    new Uint8Array(readFileSync(new URL("../../../public/nihongo.db", import.meta.url)))
  );
  try {
    const result = db.exec("SELECT id, kanji, kana FROM words ORDER BY id")[0];
    if (!result) throw new Error("nihongo.db 没有 words 表或词条");
    const positions = Object.fromEntries(result.columns.map((name, index) => [name, index]));
    words = result.values.map((row) => ({
      id: Number(row[positions.id]),
      kanji: String(row[positions.kanji]),
      kana: String(row[positions.kana])
    }));
  } finally {
    db.close();
  }
});

describe("spellingTargetForWord", () => {
  it("包含规格列出的 JMdict 与外来语样例", () => {
    const okonaTarget = spellingTargetForWord({ kanji: "行う", kana: "おこなう" });
    expect(okonaTarget.forms[0]).toEqual({ surface: "行う", tag: "standard" });
    expect(okonaTarget.forms).toContainEqual({ surface: "行なう", tag: "variant" });

    const applicationTarget = spellingTargetForWord({ kanji: "申し込み", kana: "もうしこみ" });
    expect(applicationTarget.forms).toContainEqual({ surface: "申込み", tag: "variant" });
    expect(applicationTarget.forms).toContainEqual({ surface: "申込", tag: "variant" });

    expect(spellingTargetForWord({ kanji: "食べる", kana: "たべる" }).forms)
      .not.toContainEqual({ surface: "喰べる", tag: expect.any(String) });
    expect(spellingTargetForWord({ kanji: "出来る", kana: "できる" }).forms)
      .not.toContainEqual({ surface: "出きる", tag: expect.any(String) });

    expect(spellingTargetForWord({ kanji: "あさって", kana: "あさって" }).forms)
      .toContainEqual({ surface: "明後日", tag: "variant" });
    expect(spellingTargetForWord({ kanji: "明日", kana: "あした" }).altReadings).toContain("あす");

    const tobacco = spellingTargetForWord({ id: 949, kanji: "(ポ) tabaco", kana: "タバコ" });
    expect(tobacco.isLoanword).toBe(true);
    expect(tobacco.sourceText).toBe("tabaco");
    expect(tobacco.forms).toContainEqual({ surface: "煙草", tag: "variant" });
    expect(tobacco.altReadings).toEqual([]);

    const camera = spellingTargetForWord({ kanji: "camera", kana: "カメラ" });
    expect(camera.isLoanword).toBe(true);
    expect(camera.sourceText).toBe("camera");
    expect(camera.surface).toBe("カメラ");
    expect(spellingTargetForWord({ kanji: "apartment house", kana: "アパート" }).sourceText)
      .toBe("apartment house");

    const kanaBandWithKanji = spellingTargetForWord({ kanji: "擦り抜ける", kana: "すりぬける" });
    expect(kanaBandWithKanji.forms[0]).toEqual({ surface: "すり抜ける", tag: "standard" });
    expect(kanaBandWithKanji.forms).toContainEqual({ surface: "擦り抜ける", tag: "variant" });
  });

  it("保留完整出厂词库不变量", () => {
    expect(words).toHaveLength(10919);
    for (const word of words) {
      const target = spellingTargetForWord(word);
      const primary = cleanWordSurface(word.kanji);
      const preferredKanjiSurface = hanPattern.test(preferredWordSurface(word))
        ? preferredWordSurface(word)
        : "";

      expect(target.kana).toBe(cleanWordSurface(word.kana).replace(ignoredMarks, "").normalize("NFC"));
      expect(target.surface).toBe(preferredWordSurface(word));
      expect(target.isLoanword).toBe(isLoanwordSourceSurface(word));
      if (hanPattern.test(primary) && !target.isLoanword) {
        expect(target.forms[0]?.tag).toBe("standard");
        expect(target.forms[0]?.surface).toBe(preferredKanjiSurface || primary);
      }
      for (const form of target.forms) {
        expect(hanPattern.test(form.surface)).toBe(true);
        expect(form.surface).not.toBe(target.kana);
      }
      expect(target.altReadings).not.toContain(target.kana);
      expect(target.altReadings.every((reading) => hiraganaPattern.test(reading))).toBe(true);
      if (katakanaPattern.test(target.kana) && !/[\u3041-\u309f]/u.test(target.kana)) {
        expect(target.altReadings).toEqual([]);
      }
    }
  });

  it("数据键和每条写法稳定排序，构建脚本连续两次输出相同", () => {
    const data = readData("../../data/spelling_forms.json");
    const originalJson = readFileSync(new URL("../../data/spelling_forms.json", import.meta.url), "utf8");
    const originalReport = readFileSync(
      new URL("../../../../docs/audits/2026-10-02-spelling-forms.md", import.meta.url),
      "utf8"
    );
    const keys = Object.keys(data.entries);
    expect(keys).toEqual([...keys].sort(codePointOrder));
    expect(originalJson).toBe(JSON.stringify(data) + "\n");
    expect(data.version).toBe(SPELLING_FORMS_VERSION);
    const tagOrder: Record<string, number> = { variant: 1, rare: 2, ateji: 3 };
    for (const entry of Object.values(data.entries) as Array<{ f?: [string, string][]; r?: string[] }>) {
      if (entry.f) {
        expect(entry.f).toEqual([...entry.f].sort((left, right) =>
          tagOrder[left[1]] - tagOrder[right[1]] || codePointOrder(left[0], right[0])
        ));
        expect(new Set(entry.f.map(([surface]) => surface)).size).toBe(entry.f.length);
      }
      if (entry.r) {
        expect(entry.r).toEqual([...new Set(entry.r)].sort(codePointOrder));
      }
    }

    // 构建脚本读 frontend/.local/JMdict_e.gz（gitignore，CI 的干净 checkout 里没有），没有就只验上面的数据不变量。
    // 脚本会改写 spelling_forms.json 和审计文档，跑完无论成败都还原，免得每次跑测试都弄脏工作区。
    const frontend = fileURLToPath(new URL("../../../", import.meta.url));
    if (!existsSync(new URL("../../../.local/JMdict_e.gz", import.meta.url))) return;
    const builder = fileURLToPath(new URL("../../../scripts/build-spelling-forms.mjs", import.meta.url));
    const jsonUrl = new URL("../../data/spelling_forms.json", import.meta.url);
    const reportUrl = new URL("../../../../docs/audits/2026-10-02-spelling-forms.md", import.meta.url);
    try {
      execFileSync(process.execPath, [builder], { cwd: frontend, stdio: "pipe" });
      const firstJson = readFileSync(jsonUrl, "utf8");
      const firstReport = readFileSync(reportUrl, "utf8");
      execFileSync(process.execPath, [builder], { cwd: frontend, stdio: "pipe" });
      expect(readFileSync(jsonUrl, "utf8")).toBe(firstJson);
      expect(readFileSync(reportUrl, "utf8")).toBe(firstReport);
      expect(firstJson).toBe(originalJson);
      expect(firstReport).toBe(originalReport);
    } finally {
      writeFileSync(jsonUrl, originalJson);
      writeFileSync(reportUrl, originalReport);
    }
  }, 30000);
});
