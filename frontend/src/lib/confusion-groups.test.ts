import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;

vi.mock("./database", () => ({
  getDatabase: () => testDb,
  initDatabase: async () => testDb,
  exportDatabase: () => null,
  importDatabase: async () => undefined
}));

import {
  confusionGroups,
  CONFUSION_TYPES,
  duplicateMergeTargets,
  firstSense,
  groupWords,
  masteredConfusionKeys,
  resetConfusionGroups,
  TYPE_META,
  TYPE_PRIORITY,
  type ConfusionGroup
} from "./confusion-groups";
import { matchable } from "./confusion-cards";
import { quizGroups } from "./distinction-quiz";
import { distinctionReviewFor } from "../data/confusion_distinction_reviews";
import {
  EXCLUDED_SYNONYM_GROUPS,
  MANUAL_VARIANT_GROUPS,
  RETAINED_SURFACE_COLLISIONS
} from "../data/confusion_manual_review";

const findGroup = (groups: ConfusionGroup[], key: string) => groups.find((group) => group.key === key);

describe("疑难辨析分组", () => {
  let groups: ConfusionGroup[];

  beforeAll(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database(new Uint8Array(readFileSync(
      fileURLToPath(new URL("../../public/nihongo.db", import.meta.url))
    )));
    groups = confusionGroups();
  });

  it("八类都分得出来,组数在合理量级", () => {
    const byType = new Map<string, number>();
    groups.forEach((group) => byType.set(group.type, (byType.get(group.type) ?? 0) + 1));
    // 每一类都必须有货 —— 少了任何一类都说明判据写错了
    CONFUSION_TYPES.forEach((type) => expect(byType.get(type) ?? 0).toBeGreaterThan(0));
    expect(groups.length).toBeGreaterThan(500);
    expect(CONFUSION_TYPES.slice(-2)).toEqual(["synonym", "near-synonym"]);
    expect(TYPE_PRIORITY.slice(-2)).toEqual(["synonym", "near-synonym"]);
    expect(TYPE_META.synonym.name).toBe("首义相同");
    expect(TYPE_META["near-synonym"].name).toBe("释义相近");
    expect(TYPE_META["near-synonym"].Icon).toBe(TYPE_META.synonym.Icon);
  });

  it("同音异义按假名成组,首义必须互不相同", () => {
    const group = findGroup(groups, "homophone:こうえん");
    expect(group).toBeTruthy();
    const forms = group!.members.map((member) => member.kanji);
    expect(forms).toContain("公園");
    expect(forms).toContain("講演");
  });

  it("同表記異読み按汉字成组 —— 这类假名不同,按假名分的组抓不到", () => {
    const group = findGroup(groups, "reading-register:明後日");
    expect(group).toBeTruthy();
    expect(group!.members.map((member) => member.kana).sort()).toEqual(["あさって", "みょうごにち"]);
  });

  it("纯异写不算易混词,不进分组", () => {
    // 繋がる / つながる 读音相同、意思相同、只是一个写汉字一个不写 —— 同一个词的
    // 两种写法,收进来只会让用户去找不存在的区别。
    //
    // 判据必须是「同假名 + 同首义 + 有一方没汉字」三条同时成立。只看「有一方没
    // 汉字」会误伤 文化/カルチャー、牛乳/ミルク 这种和語 vs 外来語的对子 ——
    // 那是真的语种差异,正是要教的东西。
    // 「同首义」按分组用的冻结词典首义(senseKey)判,和算法同一把尺子。按当前释义判的话,
    // 释义审校把 もっとも(な形,当然)改写成「最」之后,它和 最も 这对真同音词会被误报成异写。
    const variants = groups.filter((group) => group.members.some((left) =>
      group.members.some((right) => right.id !== left.id
        && right.kana === left.kana
        && right.senseKey === left.senseKey
        && !/[㐀-鿿]/.test(right.kanji))));
    expect(variants).toHaveLength(0);
  });

  it("和語 vs 外来語的对子要留着 —— 那是语种差异,不是异写", () => {
    const group = findGroup(groups, "synonym:牛奶");
    expect(group?.members.map((member) => member.kana).sort()).toEqual(["ぎゅうにゅう", "ミルク"]);
  });

  it("组内成员不超过上限 —— 超了说明分组滚了雪球", () => {
    groups.forEach((group) => {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
      expect(group.members.length).toBeLessThanOrEqual(8);
    });
  });

  it("key 用词形不用 word_id —— id 被去重和外来語合并动过", () => {
    groups.forEach((group) => {
      if (group.type === "near-synonym") expect(group.key).toBe(`synonym:${group.label}`);
      else if (group.key.startsWith("synonym-now:")) {
        expect(group.type).toBe("synonym");
        expect(group.key).toBe(`synonym-now:${group.label}`);
      } else expect(group.key).toBe(`${group.type}:${group.label}`);
      expect(group.key).not.toMatch(/:\d+$/);
    });
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });

  it("老用户库里没合并的外来語重复行不能当成同音异义", () => {
    // 用户真实截图里出现过「同音异义 スピーチ / スピーチ」—— 自己跟自己辨析。
    // 出厂库 bake 已经合并了这类行,但**老用户的库不会**(那次去重刻意没做迁移,
    // 删行会连带删掉挂在上面的学习记录),所以分组本身必须扛得住。
    //
    // 关键点:老库里英文行的释义是「speech讲话，演说，致词」,英文原词粘在中文
    // 前面,首义和片假名行的「演讲」对不上 —— 靠「首义相同」判是拦不住的。
    testDb.run(`
      INSERT INTO words (id, kanji, kana, meaning, pos, jlpt_level) VALUES
        (900001, 'speech', 'スピーチテスト', 'speech讲话，演说，致词', '名词', NULL),
        (900002, 'スピーチテスト', 'スピーチテスト', '演讲', '名词', 'N3')
    `);
    resetConfusionGroups();
    expect(findGroup(confusionGroups(), "homophone:スピーチテスト")).toBeUndefined();

    testDb.run("DELETE FROM words WHERE id IN (900001, 900002)");
    resetConfusionGroups();
  });

  it("没有一组是自己跟自己辨析 —— 摆出来的两列不能是同一个词形", () => {
    // 三种来源都会造出这种组:老库同一个词录了两遍(貴方/あなた + あなた/あなた)、
    // 同一个词的异体写法(片づける + 片付ける)、方括号注音摘掉后重名(蕎麦[そば] + 蕎麦)。
    // duplicateWordIds 只挡得住释义首义也一样的那批,剩下的靠 add() 按显示形态收口。
    const collapsed = confusionGroups().filter((group) => {
      const shown = groupWords(group).split(" / ");
      return new Set(shown).size < shown.length;
    });
    expect(collapsed.map((group) => `${group.key} → ${groupWords(group)}`)).toEqual([]);
  });

  it("同表記異読み不能被显示形态去重误删 —— 那类摆的本来就是读音", () => {
    // 開く = あく / ひらく:两个成员的汉字是同一个,去重要按 kana 算,不然整组会被删掉
    const readingGroups = confusionGroups().filter((group) =>
      group.type === "reading-sense" || group.type === "reading-register");
    expect(readingGroups.length).toBeGreaterThan(10);
    readingGroups.forEach((group) => {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("真正的同音外来語要留着 —— 两行都是英文原词,不是同一个词录两遍", () => {
    testDb.run(`
      INSERT INTO words (id, kanji, kana, meaning, pos, jlpt_level) VALUES
        (900002, 'lock', 'ロツク', '锁', '名词', NULL),
        (900003, 'rock', 'ロツク', '摇滚', '名词', NULL)
    `);
    resetConfusionGroups();
    const group = findGroup(confusionGroups(), "homophone:ロツク");
    expect(group?.members.map((member) => member.kanji).sort()).toEqual(["lock", "rock"]);

    testDb.run("DELETE FROM words WHERE id IN (900002, 900003)");
    resetConfusionGroups();
  });

  it("人工审校的同词异写都进入合并计划,而不是伪装成辨析", () => {
    const targets = duplicateMergeTargets();
    MANUAL_VARIANT_GROUPS.forEach((review) => {
      const members = review.members
        .map(([kanji, kana]) => testDb.exec(
          "SELECT id FROM words WHERE kanji = ? AND kana = ?",
          [kanji, kana]
        )[0]?.values?.[0]?.[0])
        .filter((id): id is number => id !== undefined)
        .map(Number);
      if (members.length < 2) return;
      const [left, right] = members;
      expect(
        targets.get(left) === right || targets.get(right) === left,
        `${review.id} 没有进入重复词条合并计划`
      ).toBe(true);
    });
  });

  it("人工保留的同形碰撞不被误判成重复词条", () => {
    const targets = duplicateMergeTargets();
    RETAINED_SURFACE_COLLISIONS.forEach((review) => {
      review.members.forEach(([kanji, kana]) => {
        const id = testDb.exec(
          "SELECT id FROM words WHERE kanji = ? AND kana = ?",
          [kanji, kana]
        )[0]?.values?.[0]?.[0];
        if (id === undefined) return;
        expect(targets.has(Number(id)), `${review.id} 被错误加入重复词条合并计划`).toBe(false);
      });
    });
  });

  it("人工排除的中文同形组不再作为首义相同或释义相近辨析", () => {
    const synonymGroups = confusionGroups().filter((group) => group.type === "synonym" || group.type === "near-synonym");
    EXCLUDED_SYNONYM_GROUPS.forEach((review) => {
      const expected = new Set(review.members.map(([kanji, kana]) => `${kanji}\u0000${kana}`));
      expect(synonymGroups.some((group) => {
        const actual = new Set(group.members.map((member) => `${member.kanji}\u0000${member.kana}`));
        return actual.size === expected.size && [...expected].every((key) => actual.has(key));
      }), `${review.id} 仍然出现在 synonym 分组`).toBe(false);
    });
  });

  it("出厂库重新分类和补组不改变 Anki 卡组、quizGroups 的基线数量及成员", () => {
    // 2026-10-10 从 HEAD 原函数独立复跑的数量与 key/成员指纹，不能只比总数。
    const cards = groups.filter(matchable);
    const quiz = CONFUSION_TYPES.flatMap((type) => quizGroups({ kind: "type", type }));
    const signature = (items: ConfusionGroup[]) => createHash("sha256").update(JSON.stringify(items
      .map((group) => [group.key, group.members.map((member) => member.id).sort((a, b) => a - b)])
      .sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))).digest("hex");
    const baselineSignature = "a5888349fc7933cd30442644d8fe6de4c36ff083d644db55df9abde41506f7e7";
    expect(cards).toHaveLength(344);
    expect(quiz).toHaveLength(344);
    expect(signature(cards)).toBe(baselineSignature);
    expect(signature(quiz)).toBe(baselineSignature);
    const frozen = groups.filter((group) => group.key.startsWith("synonym:"));
    expect(frozen).toHaveLength(814);
    expect(signature(frozen)).toBe("aaa68396d29946a0701b7c39ed128711a7abf628bb8735d29a8f39fcb5e3c1f7");
    expect(groups.filter((group) => group.type === "near-synonym")).toHaveLength(315);
    expect(groups.filter((group) => group.key.startsWith("synonym-now:"))).toHaveLength(72);
    expect(groups.filter((group) => group.type === "synonym")).toHaveLength(571);
  });
});

describe("括号感知的首义", () => {
  it.each(["；", ";", "，", ",", "、"])("只在括号外的 %s 切分并 trim", (separator) => {
    expect(firstSense(`  （工作${separator}任务(长期${separator}短期)）结束 ${separator}完  `))
      .toBe(`（工作${separator}任务(长期${separator}短期)）结束`);
    expect(firstSense(`  (工作（长期${separator}短期）${separator}任务)结束 ${separator}完  `))
      .toBe(`(工作（长期${separator}短期）${separator}任务)结束`);
    expect(firstSense(`  结束 ${separator}完  `)).toBe("结束");
  });

  it("没有括号外分隔符时保留完整释义，空串仍为空", () => {
    expect(firstSense("（工作）结束，完")).toBe("（工作）结束");
    expect(firstSense("  （工作，任务）结束  ")).toBe("（工作，任务）结束");
    expect(firstSense("  (工作;任务)结束  ")).toBe("(工作;任务)结束");
    expect(firstSense("  ")).toBe("");
  });
});

describe("冻结首义与现行首义的分组", () => {
  beforeEach(async () => {
    const SQL = await initSqlJs();
    testDb = new SQL.Database();
    testDb.run(`CREATE TABLE words (
      id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT, meaning TEXT, sense_key TEXT DEFAULT '',
      pos TEXT DEFAULT '名词', verb_type TEXT DEFAULT '', example_jp TEXT DEFAULT '',
      example_meaning TEXT DEFAULT '', jlpt_level TEXT DEFAULT 'N5'
    )`);
    resetConfusionGroups();
  });

  afterEach(() => {
    testDb.close();
    resetConfusionGroups();
  });

  it("冻结组的现行首义分叉后只变类型，key、label、掌握标记与人工稿不丢", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning, sense_key) VALUES
      (1, '医者', 'いしゃ', '医生', '医生'), (2, '医師', 'いし', '医生', '医生')`);
    testDb.run("CREATE TABLE confusion_mastered (group_key TEXT PRIMARY KEY, mastered_on TEXT)");
    testDb.run("INSERT INTO confusion_mastered VALUES ('synonym:医生', '2026-10-09')");
    const before = findGroup(confusionGroups(), "synonym:医生")!;
    expect(before.type).toBe("synonym");
    const review = distinctionReviewFor(before.key);
    expect(review).not.toBeNull();
    testDb.run("UPDATE words SET meaning = '医师（有执照）' WHERE id = 2");
    resetConfusionGroups();
    const after = findGroup(confusionGroups(), before.key)!;
    expect(after.type).toBe("near-synonym");
    expect(after.label).toBe(before.label);
    expect(after.members.map((member) => member.id)).toEqual(before.members.map((member) => member.id));
    expect(masteredConfusionKeys().has(after.key)).toBe(true);
    expect(distinctionReviewFor(after.key)).toBe(review);
    expect(matchable(after)).toBe(false);
    expect(quizGroups({ kind: "group", key: after.key })).toEqual([]);
  });

  it("sense_key 不同但现行首义相同时以 synonym-now 补组", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning, sense_key) VALUES
      (1, '答え', 'こたえ', '答案；回答', '回答'), (2, '答案', 'とうあん', '答案；试卷', '试卷')`);
    const group = findGroup(confusionGroups(), "synonym-now:答案")!;
    expect(group.type).toBe("synonym");
    expect(group.label).toBe("答案");
    expect(group.members.map((member) => member.id)).toEqual([1, 2]);
    expect(group.members.map((member) => member.senseKey)).toEqual(["回答", "试卷"]);
    expect(matchable(group)).toBe(false);
    expect(quizGroups({ kind: "group", key: group.key })).toEqual([]);
  });

  it("没有冻结键或旧表没有 sense_key 时，退回括号感知的首义", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning) VALUES
      (1, '甲', 'こう', '（工作，任务）结束；完'), (2, '乙', 'おつ', '（工作，任务）结束、完毕')`);
    const key = "synonym:（工作，任务）结束";
    expect(findGroup(confusionGroups(), key)?.members.map((member) => member.senseKey))
      .toEqual(["（工作，任务）结束", "（工作，任务）结束"]);
    testDb.run("ALTER TABLE words DROP COLUMN sense_key");
    resetConfusionGroups();
    expect(findGroup(confusionGroups(), key)?.type).toBe("synonym");
  });

  it("成员已同在冻结 synonym 组时不重复补组", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning, sense_key) VALUES
      (1, '牛乳', 'ぎゅうにゅう', '牛奶', '奶'), (2, 'milk', 'ミルク', '牛奶；乳汁', '奶')`);
    expect(confusionGroups().map((group) => group.key)).toEqual(["synonym:奶"]);
  });

  it("成员是其它类型已有组的子集时也不重复补组", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning, sense_key) VALUES
      (1, '公園', 'こうえん', '测试首义', '公园'), (2, '講演', 'こうえん', '测试首义', '演讲'),
      (3, '公演', 'こうえん', '演出', '演出')`);
    expect(confusionGroups().map((group) => group.key)).toEqual(["homophone:こうえん"]);
  });

  it("现行首义补组仍要求词性唯一，并沿用人工排除名单", () => {
    testDb.run(`INSERT INTO words (id, kanji, kana, meaning, sense_key, pos) VALUES
      (1, '甲', 'こう', '测试首义', '甲义', '名词'), (2, '乙', 'おつ', '测试首义', '乙义', '动词')`);
    expect(confusionGroups()).toEqual([]);
    testDb.run("DELETE FROM words");
    const excluded = EXCLUDED_SYNONYM_GROUPS[0];
    excluded.members.forEach(([kanji, kana], index) => testDb.run(
      "INSERT INTO words (id, kanji, kana, meaning, sense_key) VALUES (?, ?, ?, ?, ?)",
      [index + 1, kanji, kana, "测试首义", `独立冻结义${index}`]
    ));
    resetConfusionGroups();
    expect(findGroup(confusionGroups(), "synonym-now:测试首义")).toBeUndefined();
  });
});
