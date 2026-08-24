import { describe, expect, it } from "vitest";
import payload from "../data/kanji_reading_usage.json";
import { clauseText, decodeUsagePayload, type KanjiCharUsage } from "./kanji-reading-usage";

const loaded = decodeUsagePayload(payload as never);
const at = (char: string): KanjiCharUsage => {
  const entry = loaded.byChar.get(char);
  if (!entry) throw new Error(`表里没有 ${char}`);
  return entry;
};
const reading = (char: string, base: string) => {
  const found = at(char).readings.find((item) => item.base === base);
  if (!found) throw new Error(`${char} 没有读音 ${base}`);
  return found;
};

describe("一字多音的说明表", () => {
  it("只收多音字：每个字至少两个读音", () => {
    expect(loaded.chars.length).toBeGreaterThan(400);
    for (const entry of loaded.chars) expect(entry.readings.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * 整张表的核心不变量:**每一行都说得出话**。
   * 判据说不清的读音必须被人工说明接住 —— 生成脚本的 pending 清零就是这件事,
   * 这里从产物这一侧再钉一遍,免得改判据时悄悄漏掉一批。
   */
  it("没有一个读音是空说明", () => {
    const empty = loaded.chars.flatMap((entry) =>
      entry.readings.filter((item) => !clauseText(item).trim()).map((item) => `${entry.char}|${item.base}`)
    );
    expect(empty).toEqual([]);
  });

  /**
   * 同一个字里两行说明**逐字相同** = 这句话没有区分开任何东西。
   * 原型阶段 行(い/ゆ)、重(じゅう/ちょう)、大(だい/たい) 都是这样撞上的,
   * 撞车正是「该交给人写」的判据本身。
   */
  it("同一个字里没有两行说明是一模一样的", () => {
    const collisions: string[] = [];
    for (const entry of loaded.chars) {
      const seen = new Map<string, string>();
      for (const item of entry.readings) {
        const text = clauseText(item);
        const previous = seen.get(text);
        if (previous) collisions.push(`${entry.char}: ${previous} / ${item.base} 都写「${text}」`);
        else seen.set(text, item.base);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("月：三个读音都明确写出各自使用场景", () => {
    expect(clauseText(reading("月", "がつ"))).toContain("月份名称");
    expect(clauseText(reading("月", "げつ"))).toContain("时长");
    expect(clauseText(reading("月", "つき"))).toContain("月亮");
    expect(at("月").readings.every((item) => item.manual)).toBe(true);
    expect(reading("月", "がつ").examples.map((item) => item.surface)).toContain("二月");
  });

  /**
   * 回归:原型把 月(つき) 写成「只出现在 毎月・月・年月・三日月」——
   * つき 是月亮,是这个字最基本的读法,例词少只是因为训读天生少进复合词。
   * `list` 判据从此只对音读用。
   */
  it("词表归纳只用于音读，不会把例词少的基本训读说成冷门音", () => {
    const misread = loaded.chars.flatMap((entry) =>
      entry.readings
        .filter((item) => item.clause === "list" && !item.kinds.includes("on"))
        .map((item) => `${entry.char}|${item.base}`)
    );
    expect(misread).toEqual([]);
  });

  it("封闭词表只给真冷门的音：例词不超过 4 个", () => {
    for (const entry of loaded.chars) {
      for (const item of entry.readings) {
        if (item.clause === "list") expect(item.count).toBeLessThanOrEqual(4);
      }
    }
  });

  it("人写的那批盖在两个音读撞车的地方：人 じん/にん、大 だい/たい", () => {
    expect(reading("人", "じん").manual).toBe(true);
    expect(reading("人", "にん").manual).toBe(true);
    expect(clauseText(reading("人", "じん"))).toContain("国籍");
    expect(reading("大", "たい").manual).toBe(true);
    expect(at("大").hasManual).toBe(true);
  });

  /**
   * 自动判据最危险的地方不是「一音读+一训读」,而是同一个字里有两个以上音读
   * 或两个以上训读。那时只写「音读」「带送假名」往往没有说出语义、语体和固定词。
   * 这 131 个字已经逐项人工复核；今后词库新增同类结构时也必须重新进人工队列。
   */
  it("同字存在多个同类读音时，每一行都必须由人工辨析接住", () => {
    const uncovered = loaded.chars.flatMap((entry) => (["on", "kun"] as const).flatMap((kind) => {
      const siblings = entry.readings.filter((item) => item.kinds.includes(kind));
      if (siblings.length < 2) return [];
      return siblings.filter((item) => !item.manual).map((item) => `${entry.char}|${item.base}|${kind}`);
    }));

    expect(uncovered).toEqual([]);
    expect(loaded.chars.filter((entry) => entry.hasManual).length).toBe(131);
  });

  it("人工说明纠正频次倒置、活用误分和假名选择这三类机械错误", () => {
    expect(clauseText(reading("万", "まん"))).toContain("数字");
    expect(at("万").summary).toContain("样本偏差");
    expect(at("来").summary).toContain("不规则动词");
    expect(clauseText(reading("来", "き"))).toContain("活用形");
    expect(at("何").summary).toContain("不能按一个送假名硬分");
    expect(clauseText(reading("何", "なん"))).toContain("数量词");
  });

  it("词库归纳不再冒充整个日语的绝对封闭词表", () => {
    const autoList = loaded.chars.flatMap((entry) => entry.readings.filter((item) => item.clause === "list"));
    for (const item of autoList) {
      expect(clauseText(item)).toContain("当前词库");
      expect(clauseText(item)).not.toContain("只出现在");
    }
  });

  /**
   * 送假名形态要能把兄弟读音**真的**分开。
   * 冷(ひ) 最常见形态是「える」,但它还有 冷やす —— 只报 top-1 的话,
   * 看到 冷やす 的人对不上号。全库 356 个读音有过这个毛病。
   */
  it("同一个字上有两个送假名读音时，人工说明写清真实语义差", () => {
    expect(clauseText(reading("冷", "ひ"))).toContain("从常温变冷");
    expect(clauseText(reading("冷", "さ"))).toContain("原本热的东西");
    expect(reading("冷", "ひ").manual).toBe(true);
    expect(reading("冷", "さ").manual).toBe(true);
  });

  /**
   * 两个读音共用同一个送假名形态时,送假名根本分不开(止める = とめる / やめる),
   * 这个字整体转人工。**不能只把共用的那个形态从两边悄悄删掉** ——
   * 那样 と 写「〜まる」、や 写「〜む」看着分得清清楚楚,而真正会卡住人的
   * 止める 两边都不提。全库这样的只有 6 个字。
   */
  it("送假名共用形态的六个字全部由人写", () => {
    for (const char of ["入", "行", "開", "止", "降", "描"]) {
      expect(at(char).hasManual).toBe(true);
    }
    expect(at("止").summary).toContain("止める");
    expect(clauseText(reading("止", "や"))).toContain("作罢");
  });

  /**
   * 「读哪个音」靠送假名,「是哪个意思」只有释义说得出来。
   * 冷える(变冷) / 冷ます(晾凉) —— 这一列本来就在 words 表里,不用人写。
   */
  it("例词带释义", () => {
    const glosses = reading("冷", "さ").examples.map((item) => item.meaning);
    expect(glosses.every((text) => text.length > 0)).toBe(true);
    expect(glosses.join(" ")).toContain("晾凉");
    const missing = loaded.chars.flatMap((entry) =>
      entry.readings.flatMap((item) => item.examples.filter((ex) => !ex.meaning))
    );
    // 老库里有极少数词条释义为空，允许存在但不该成片
    expect(missing.length).toBeLessThan(40);
  });

  it("hasSpecific 认得出「纯音训通则」的字，界面靠它折叠重复内容", () => {
    expect(at("近").hasSpecific).toBe(false);   // きん(音读) / ちか(训读)，就是通则本身
    expect(at("月").hasSpecific).toBe(true);    // がつ 跟数字，比通则具体
    expect(at("人").hasSpecific).toBe(true);    // 人工说明
  });
});
