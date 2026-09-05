import { getDatabase } from "./database";
import { preferredWordSurface } from "./orthography";
import { rowsFor } from "./database/db-utils";
import { ensureUserTables, persistSoon } from "./study-core";
import verbPairHints from "../data/verb_pair_hints.json";
import { EXCLUDED_SYNONYM_GROUPS, MANUAL_VARIANT_GROUPS } from "../data/confusion_manual_review";
import { ArrowLeftRight, Crown, Handshake, PenLine, Sprout, Type, Volume2, type LucideIcon } from "lucide-react";

/**
 * 疑难辨析的词组。
 *
 * 「易混」不是一件事，是六件互不重叠的事 —— 混淆的原因不同，看的地方就不同：
 * 自他对看助词、同音组看语境、同词根族看格框架、纯近义则根本没有区别可看。
 * 所以每组都带 type，界面按 type 说该看哪里，而不是笼统地说「这几个词像」。
 *
 * 分组在运行时现算并缓存，不预生成 JSON：这些关系全部是从 words 表推出来的，
 * 落盘一份只会让主包变大、还会和词库改动悄悄脱节（词单导入新增的词进不了组）。
 * 全表一遍正则约 30ms，只做一次。
 */

export type ConfusionType =
  /** 自他动词对：ドアが開く / ドアを開ける —— 助词强制唯一答案 */
  | "pair"
  /** 同音异义：こうえん = 公園 / 講演 / 公演 —— 靠语境选汉字 */
  | "homophone"
  /** 汉字使い分け：さがす = 探す(找想要的) / 捜す(找丢失的) */
  | "kanji-choice"
  /** 同表記異読み·语体：明後日 = あさって(口语) / みょうごにち(正式) */
  | "reading-register"
  /** 同表記異読み·多义：開く = あく(开着) / ひらく(打开) */
  | "reading-sense"
  /** 同词根动词族：下がる / 下げる / 下ろす */
  | "stem"
  /** 中文提示相同的近义词：晩ご飯 / 夕食 / 夕飯 —— 多半可互换 */
  | "synonym";

export interface ConfusionMember {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  exampleJp: string;
  exampleMeaning: string;
  jlptLevel: string;
}

export interface ConfusionGroup {
  /**
   * 稳定标识，「已掌握」按它记。
   *
   * 刻意用词形而不是 word_id 当锚点：去重和外来語合并动过 id（見 bake-seed-db
   * 的 loanword-merge-map），拿 id 拼 key 会让用户标过的掌握状态在下次清库后全丢。
   */
  key: string;
  type: ConfusionType;
  /** 组的锚点，也是标题：假名 / 汉字写法 / 中文首义 */
  label: string;
  members: ConfusionMember[];
}

/** 超过这个成员数的多半不是「两两互混」，而是分组滚了雪球（「取」族有 17 个） */
const MAX_MEMBERS = 8;

const CJK = /[㐀-鿿]/;
const LATIN = /[A-Za-z]/;

interface Row {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  pos: string;
  verbType: string;
  exampleJp: string;
  exampleMeaning: string;
  jlptLevel: string;
}

const firstSense = (meaning: string): string =>
  meaning.split(/[；;，,、]/)[0].trim();

const toMember = (row: Row): ConfusionMember => ({
  id: row.id,
  kanji: row.kanji,
  kana: row.kana,
  meaning: row.meaning,
  exampleJp: row.exampleJp,
  exampleMeaning: row.exampleMeaning,
  jlptLevel: row.jlptLevel
});

/** 越靠前越具体：同一批词同时命中多个类型时，保留信息量最大的那个说法 */
export const TYPE_PRIORITY: ConfusionType[] = [
  "pair", "kanji-choice", "reading-register", "reading-sense", "homophone", "stem", "synonym"
];

const groupBy = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const buckets = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!key) return;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  });
  return buckets;
};

/**
 * 纯异写要在分组之前就整行剔掉,不能只在同假名那一步跳过。
 *
 * 繋がる / つながる 是同一个词的两种写法。同假名那一步确实会丢掉它们,但按中文
 * 首义分组的 synonym 那条路会把两行**重新捞回来** —— 它们的中文当然一样。
 * 结果就是「相连」组里同时躺着 繋がる 和 つながる,用户会去找根本不存在的区别。
 *
 * 判据三条同时成立:同假名 + 同首义 + 有一方没汉字。少一条都不行 ——
 * 只看「有一方没汉字」会误伤 牛乳/ミルク 这种和語 vs 外来語的对子,那是真的语种差异。
 * 保留写汉字的那行(词典形态),丢掉纯假名那行。
 */
/**
 * 返回「重复行 → 它并到哪一行」的对照表。
 *
 * 以前这里只吐一个 id 集合（谁该被挡掉），够辨析用；但真正合并数据时还得知道
 * **并到谁身上**，两份判据分家迟早会打架，所以survivor 一并在这里记下来。
 */
const variantMerges = (rows: Row[]): Map<number, number> => {
  const merges = new Map<number, number>();
  const suppressed = new Set<number>();
  const drop = (row: Row, survivor: Row) => {
    suppressed.add(row.id);
    merges.set(row.id, survivor.id);
  };

  // 汉字和假名都一模一样 = 同一个词录了两遍,不管释义那一栏写得一不一样。
  // 老库里 運動/運動、説明|说明 vs 説明|说明，解释、チェック|检查 vs チェック|check核对…
  // 共 202 对里最脏的一批。**不能按释义判**:重录的那行常常是从另一本词典抄的,
  // 释义写法不同(甚至把英文原词粘在前面),按首义分桶会把它们分到两个桶里,
  // 于是永远碰不到面,最后堂而皇之地成为一组「汉字用法」——自己跟自己辨析。
  //
  // 同汉字同假名的两行不可能是两个词:一形多読(開く = あく/ひらく)假名不同,
  // 同音异义(公園/講演)汉字不同。两样都一样就只剩「录了两遍」一种可能。
  groupBy(rows, (row) => (row.kanji ? `${row.kanji}\u0000${row.kana}` : "")).forEach((members) => {
    if (members.length < 2) return;
    const [survivor, ...losers] = [...members].sort((left, right) => rank(left) - rank(right) || left.id - right.id);
    losers.forEach((row) => drop(row, survivor));
  });

  // 外来語被录了两遍:同一个假名下,一行 kanji 存英文原词(speech),一行存片假名
  // (スピーチ)。出厂库里 bake 已经合并掉了,但**老用户的库不会**  —— 那次去重
  // 刻意没做迁移(删行会连带删掉挂在上面的学习记录),所以这里必须自己扛住。
  //
  // 不能靠「首义相同」判:老库里英文行的释义是「speech讲话，演说，致词」,英文原词
  // 粘在中文前面,首义和片假名行的「演讲」对不上,于是两行被当成同音异义词,
  // 卡面就出现「スピーチ / スピーチ」这种自己跟自己辨析的组。
  //
  // 「恰好一行拉丁 + 恰好一行 kanji 原样重复假名」这个形态只可能是同一个词录了
  // 两遍。真的同音外来語(ロック = lock / rock)是两行拉丁,不会命中。
  //
  // 上一轮压掉的行要排除在外:コピー 在老库里有三行(コピー / copy / コピー),
  // 先去掉重录的那行才剩下「恰好一个英文行 + 恰好一个片假名行」这个形态,
  // 否则 members.length !== 2 直接跳过,三行原样进组。
  groupBy(rows.filter((row) => !suppressed.has(row.id)), (row) => row.kana).forEach((members, kana) => {
    if (members.length !== 2) return;
    const latin = members.filter((row) => LATIN.test(row.kanji));
    const bare = members.filter((row) => row.kanji === kana);
    if (latin.length !== 1 || bare.length !== 1) return;
    const [survivor, loser] = [...members].sort((left, right) => rank(left) - rank(right) || left.id - right.id);
    drop(loser, survivor);
  });

  // 按 (假名, 首义) 而不是只按假名分桶。そば 这个假名下同时有「旁边」(そば/側) 和
  // 「荞麦面」(蕎麦/蕎麦[そば]) 两组异写,按假名整桶判会因为「首义不止一个」
  // 整桶跳过,两组异写就都漏进去了。
  //
  // 上一轮压掉的行要排除在外,否则可能把留下的那行也一起压了。
  const rest = rows.filter((row) => !suppressed.has(row.id));
  groupBy(rest, (row) => `${row.kana}\u0000${firstSense(row.meaning)}`).forEach((members) => {
    if (members.length < 2) return;
    const withKanji = members.filter((row) => CJK.test(row.kanji));
    // 全都带汉字 = 汉字使い分け(探す/捜す),这是最有价值的一类,一行都不能动。
    if (withKanji.length === members.length) return;
    // 有汉字的留下,纯假名的那些是异写(繋がる/つながる),丢掉。
    if (withKanji.length) {
      // 汉字行不止一个时(探す/捜す 那类不会走到这)，并到资料最全的那行
      const survivor = [...withKanji].sort((left, right) => rank(left) - rank(right) || left.id - right.id)[0];
      members.filter((row) => !CJK.test(row.kanji)).forEach((row) => drop(row, survivor));
      return;
    }
    // 一个汉字都没有 = 外来語被录了两遍(ロック/lock),留数据更全的那行。
    const canonical = [...members].sort((left, right) => rank(left) - rank(right) || left.id - right.id)[0];
    members.filter((row) => row.id !== canonical.id).forEach((row) => drop(row, canonical));
  });

  // 首义不同、或者成员释义字段来自不同词典时，自动规则会把同一个词漏掉。
  // 这里是人工逐项确认的稳定表记合并，不能退化成「同假名 + 有汉字」的宽规则：
  // かかる(掛かる/罹る)、やめる(辞める/止める) 等确实是不同词，必须保留。
  const manualRows = () => rows.filter((row) => !suppressed.has(row.id));
  MANUAL_VARIANT_GROUPS.forEach((group) => {
    const members = group.members
      .map(([kanji, kana]) => manualRows().find((row) => row.kanji === kanji && row.kana === kana))
      .filter((row): row is Row => Boolean(row));
    if (members.length < 2) return;
    const survivor = [...members].sort((left, right) => rank(left) - rank(right) || left.id - right.id)[0];
    members.filter((row) => row.id !== survivor.id).forEach((row) => drop(row, survivor));
  });

  // 链式压制:a 在第一条规则里并到 b,b 又在第三条规则里并到 c —— 直接留着 a→b
  // 会把数据搬到一个同样要被删掉的行上。全部收敛到最终存活的那行。
  const resolve = (id: number, seen = new Set<number>()): number => {
    const next = merges.get(id);
    if (next === undefined || seen.has(id)) return id;
    seen.add(id);
    return resolve(next, seen);
  };
  return new Map([...merges.keys()].map((id) => [id, resolve(id)]));
};

/** 资料更全的排前面：有例句 > 没例句，有级别 > 没级别。两处去重共用同一把尺子。 */
const rank = (row: Row) => (row.exampleJp ? 0 : 2) + (row.jlptLevel ? 0 : 1);

/**
 * 这一组摆出来给人看的是哪一列。
 *
 * 同表記異読み(明後日 = あさって / みょうごにち)所有成员的汉字是同一个，对照的是读音；
 * 其余类型对照的是词形。去重必须按**实际显示的那一列**算，否则要么放过
 * 「あなた / あなた」这种自己跟自己辨析，要么把 明後日 那种正经组整个误删。
 */
const memberForm = (type: ConfusionType, row: Row): string =>
  type === "reading-register" || type === "reading-sense" ? row.kana : displayForm(row);

/**
 * 去重用的身份。**不能只看显示形态**：外来語行的卡面写的是片假名，
 * lock/ロツク 和 rock/ロツク 摆出来都是「ロツク」，但那是两个词，正是该并排的一组。
 * 所以外来語再带上词源那一列；其余情况显示一样就是同一个词的两行。
 */
const memberIdentity = (type: ConfusionType, row: Row): string => {
  const form = memberForm(type, row);
  return LATIN.test(row.kanji) ? `${form}\u0000${row.kanji}` : form;
};

const buildGroups = (allRows: Row[]): ConfusionGroup[] => {
  const suppressed = duplicateWordIds();
  const rows = allRows.filter((row) => !suppressed.has(row.id));
  const found: ConfusionGroup[] = [];
  const add = (type: ConfusionType, label: string, members: Row[]) => {
    // 卡面写法一样的成员只留一个：老库里同一个词录了两遍(貴方/あなた + あなた/あなた)、
    // 或两行是同一个词的异体写法(片づける + 片付ける)，两种都会让这一组显示成
    // 「あなた / あなた」——自己跟自己辨析。duplicateWordIds 只挡得住释义首义也一样的那些，
    // 剩下的在这里按显示形态收口。
    const byForm = new Map<string, Row>();
    members.forEach((row) => {
      const key = memberIdentity(type, row);
      const kept = byForm.get(key);
      if (!kept || rank(row) < rank(kept)) byForm.set(key, row);
    });
    const unique = [...byForm.values()];
    if (unique.length < 2 || unique.length > MAX_MEMBERS) return;
    found.push({ key: `${type}:${label}`, type, label, members: unique.map(toMember) });
  };

  // ① 自他动词对。368 对现成数据，是最干净的一类：が/を 就能分开。
  const pairs = verbPairHints as unknown as Record<string, [string, string, string, string]>;
  const seenPairs = new Set<string>();
  rows.forEach((row) => {
    const hint = pairs[row.kanji] ?? pairs[row.kana];
    if (!hint) return;
    const partner = hint[1];
    const partnerKana = hint[2];
    // 搭档必须汉字和假名都对上。只按汉字找,開ける 的搭档「開く」会同时命中
    // 開く(あく) 和 開く(ひらく) —— 后者不是它的自他对,是另一个词,
    // 塞进来这组就成了「三个成员的自他动词对」,而助词那条判据只对其中两个成立。
    const mates = rows.filter((other) => (other.kanji === partner && (!partnerKana || other.kana === partnerKana))
      || other.kana === partner);
    if (!mates.length) return;
    const label = [row.kanji || row.kana, partner].sort().join(" / ");
    if (seenPairs.has(label)) return;
    seenPairs.add(label);
    add("pair", label, [row, ...mates]);
  });

  // ② 同假名。首义不同 = 真同音异义（公園/講演）；首义相同又都带汉字 =
  //    汉字使い分け（探す/捜す，日语里区别很清楚，是中文释义把它压没了）。
  //    首义相同但有一方没汉字的是纯异写（繋がる/つながる）—— 同一个词的两种
  //    写法，**不是易混词**，放进来只会让用户去找不存在的区别，直接丢掉。
  groupBy(rows, (row) => row.kana).forEach((members, kana) => {
    if (members.length < 2) return;
    const senses = new Set(members.map((row) => firstSense(row.meaning)));
    if (senses.size > 1) { add("homophone", kana, members); return; }
    if (members.every((row) => CJK.test(row.kanji))) add("kanji-choice", kana, members);
  });

  // ③ 同一个汉字写法、多个读音。这类假名不同，前面按假名分的组一个都抓不到。
  //    首义相同多半是语体差（あさって/みょうごにち），不同则是真多义（あく/ひらく）。
  groupBy(rows, (row) => (CJK.test(row.kanji) ? row.kanji : "")).forEach((members, kanji) => {
    if (new Set(members.map((row) => row.kana)).size < 2) return;
    const senses = new Set(members.map((row) => firstSense(row.meaning)));
    add(senses.size === 1 ? "reading-register" : "reading-sense", kanji, members);
  });

  // ④ 同词根动词族。只按汉字分会滚雪球（「下」族会混进 下さい、下宿），
  //    所以再要求中文首义之间有汉字重叠 —— 先按日语侧筛、再用中文过滤，
  //    比纯中文模糊匹配准得多（中文「切下」和「放下」都有「下」，日语侧毫无关系）。
  const verbs = rows.filter((row) => (row.verbType === "godan" || row.verbType === "ichidan") && CJK.test(row.kanji));
  groupBy(verbs, (row) => row.kanji.match(CJK)?.[0] ?? "").forEach((members, stem) => {
    const charsOf = (row: Row) => new Set(firstSense(row.meaning).match(/[㐀-鿿]/g) ?? []);
    const cohesive = members.filter((row) => {
      const chars = charsOf(row);
      return members.some((other) => other.id !== row.id
        && [...charsOf(other)].some((char) => chars.has(char)));
    });
    add("stem", stem, cohesive);
  });

  // ⑤ 中文首义完全相同。词性也一致的才收 —— 词性不同的那批（「运动」名词 vs
  //    する动词）多半只是题面给的信息不够，属于要修的题面 bug，不是易混词。
  groupBy(rows, (row) => firstSense(row.meaning)).forEach((members, sense) => {
    if (members.length < 2) return;
    if (new Set(members.map((row) => row.pos)).size > 1) return;
    const memberKeys = new Set(members.map((row) => `${row.kanji}\u0000${row.kana}`));
    const excluded = EXCLUDED_SYNONYM_GROUPS.some((group) => (
      group.members.length === members.length
      && group.members.every(([kanji, kana]) => memberKeys.has(`${kanji}\u0000${kana}`))
    ));
    if (excluded) return;
    add("synonym", sense, members);
  });

  // 成员完全相同的组只留最具体的那个说法：上がる/上げる 既是自他对也是「上」族，
  // 说成自他对信息量更大。
  const byMembers = new Map<string, ConfusionGroup>();
  found.forEach((group) => {
    const fingerprint = group.members.map((member) => member.id).sort((a, b) => a - b).join(",");
    const previous = byMembers.get(fingerprint);
    if (!previous || TYPE_PRIORITY.indexOf(group.type) < TYPE_PRIORITY.indexOf(previous.type)) {
      byMembers.set(fingerprint, group);
    }
  });
  return [...byMembers.values()];
};

let cached: ConfusionGroup[] | null = null;
let cachedRows: Row[] | null = null;
let cachedDuplicates: Map<number, number> | null = null;

export const resetConfusionGroups = (): void => {
  cached = null;
  cachedRows = null;
  cachedDuplicates = null;
  groupsByWord = null;
};

/**
 * 同一个词被录了两遍的那些行 —— 留下最全的一行，其余的 id 在这里。
 *
 * **三条路都得用同一份**：分组、卡片上的音形相近、题面撞车。老库里这样的行有 200 多对
 * （去重当年刻意没做数据迁移：删行会连带删掉挂在上面的学习记录），谁不过滤谁就会在
 * 界面上出现「インターネット 和 インターネット 容易混」。
 *
 * 只做行级去重，不建分组，所以比 confusionGroups() 便宜得多，可以放心在别处调。
 */
export const duplicateWordIds = (): Set<number> => new Set(duplicateMergeTargets().keys());

/** 重复行 → 它该并到哪一行。合并迁移和辨析过滤共用这一份判据。 */
export const duplicateMergeTargets = (): Map<number, number> => {
  if (!cachedDuplicates) cachedDuplicates = variantMerges(loadRows());
  return cachedDuplicates;
};

const loadRows = (): Row[] => {
  if (cachedRows) return cachedRows;
  cachedRows = rowsFor(`
    SELECT id, kanji, kana, meaning, pos, verb_type, example_jp, example_meaning, jlpt_level
    FROM words
  `).map((row): Row => ({
    id: Number(row.id ?? 0),
    kanji: String(row.kanji ?? ""),
    kana: String(row.kana ?? ""),
    meaning: String(row.meaning ?? ""),
    pos: String(row.pos ?? ""),
    verbType: String(row.verb_type ?? ""),
    exampleJp: String(row.example_jp ?? ""),
    exampleMeaning: String(row.example_meaning ?? ""),
    jlptLevel: String(row.jlpt_level ?? "")
  })).filter((row) => row.id && !LATIN.test(row.kana));
  return cachedRows;
};

export const confusionGroups = (): ConfusionGroup[] => {
  if (!cached) cached = buildGroups(loadRows());
  return cached;
};

/* ——— 「已掌握」的记忆 ——— */

export const masteredConfusionKeys = (): Set<string> =>
  new Set(rowsFor("SELECT group_key FROM confusion_mastered").map((row) => String(row.group_key ?? "")));

export const setConfusionMastered = (key: string, mastered: boolean): void => {
  ensureUserTables();
  const db = getDatabase();
  if (mastered) {
    db.run(
      "INSERT OR REPLACE INTO confusion_mastered (group_key, mastered_on) VALUES (?, date('now','localtime'))",
      [key]
    );
  } else {
    db.run("DELETE FROM confusion_mastered WHERE group_key = ?", [key]);
  }
  // sql.js 是内存库,不落盘的话刷新就没了 —— 和 toggleFavorite 同一个套路。
  persistSoon();
};

/* ——— 单词卡那边要用的：这个词属于哪几组，以及每类该怎么说 ——— */

/**
 * 每类该看哪里 —— 混淆的原因不同，眼睛要放的位置就不同。
 *
 * 放在这里而不是页面组件里：疑难辨析页和单词卡的辨析气泡是同一份说法，
 * 各留一份的话改了一处另一处会悄悄说另一套话。
 */
/** 七类的顺序：从「机制清楚」到「说法笼统」，和 word-distinctions 里的排法同向。 */
export const CONFUSION_TYPES: ConfusionType[] = [
  "pair", "homophone", "kanji-choice", "reading-sense", "reading-register", "stem", "synonym"
];

export const TYPE_META: Record<ConfusionType, { name: string; Icon: LucideIcon }> = {
  pair: {
    name: "自他动词",
    Icon: ArrowLeftRight
  },
  homophone: {
    name: "同音异义",
    Icon: Volume2
  },
  "kanji-choice": {
    name: "汉字用法",
    Icon: PenLine
  },
  "reading-register": {
    name: "读音语体",
    Icon: Crown
  },
  "reading-sense": {
    name: "一形多读",
    Icon: Type
  },
  stem: {
    name: "同词根",
    Icon: Sprout
  },
  synonym: {
    name: "中文提示相同",
    Icon: Handshake
  }
};

/**
 * 卡面显示的词形。**全应用只有这一份口径**,直接转发给 `orthography` 的
 * `preferredWordSurface`:
 *   - 外来語行的 kanji 存的是词源(camera / apartment house),退回假名,否则卡面变英文
 *   - 176 个词条的 kanji 带方括号注音(飴[あめ]、濡[ぬ]れる),摘掉;其中 28 条注音夹在
 *     词中间(茶[ちゃ] 碗[わん]),摘完要连空白一起收,否则卡面写着「茶 碗」
 *   - 现代日语里更自然写假名的词(丁度 → ちょうど)按 kanji_orthography 的判定改写
 *
 * 以前这里自己实现了前两条,而学习页走 preferredWordSurface(多了第三条)——
 * 同一个词在学习卡上是「ちょうど」、在词库里是「丁度」。别再分家。
 */
export const displayForm = (member: { kanji: string; kana: string }): string =>
  preferredWordSurface({ kanji: member.kanji ?? "", kana: member.kana ?? "" });

/**
 * 一组并排显示的是哪一列 —— 组的区别在哪一列，就并排哪一列。
 *
 * 同表記異読み(明後日 = あさって / みょうごにち)所有成员的汉字**是同一个**，
 * 并排词形会显示成「明後日 / 明後日」，等于什么都没说；那类要并排读音。
 */
/**
 * 一组并排显示的那几段，**连各自的读音一起给**（卡面要在汉字上标假名）。
 *
 * `reading` 为空 = 这一段不该标注音：并排的本来就是假名（同表記異読み那两类），
 * 或者摆的是外来語词源（lock / rock，拉丁字母标不了假名）。
 *
 * ⚠️ 和 `groupWords` 必须是同一份判据 —— 所以那个函数直接由这里派生，
 * 别再各写一遍「哪一列该并排」。
 */
export const groupWordParts = (group: ConfusionGroup): { text: string; reading: string }[] => {
  if (group.type === "reading-register" || group.type === "reading-sense") {
    return group.members.map((member) => ({ text: member.kana, reading: "" }));
  }
  const forms = group.members.map(displayForm);
  // 同音外来語(lock / rock 都读ロック)的卡面写法是同一串片假名，照直摆就是
  // 「ロック / ロック」——一组里两边看着一样，等于没说。这一类改摆词源，
  // 副标题那句「读作 ロック」已经把共同的读音讲清楚了。
  const collides = new Set(forms).size !== forms.length;
  return group.members.map((member, index) => {
    const useSource = collides && LATIN.test(member.kanji);
    return {
      text: useSource ? member.kanji : forms[index],
      reading: useSource ? "" : member.kana
    };
  });
};

export const groupWords = (group: ConfusionGroup): string =>
  groupWordParts(group).map((part) => part.text).join(" / ");

let groupsByWord: Map<number, ConfusionGroup[]> | null = null;

/**
 * 这个词落在哪几组里。按 TYPE_PRIORITY 排序，最具体的说法排前面。
 *
 * 索引建一次留着用：底下的 confusionGroups() 要扫全表跑正则（约 30ms），
 * 学习页每张卡都问一次，逐张现算会把这 30ms 乘上一整天的题量。
 */
export const confusionGroupsForWord = (wordId: number): ConfusionGroup[] => {
  if (!groupsByWord) {
    const index = new Map<number, ConfusionGroup[]>();
    confusionGroups().forEach((group) => {
      group.members.forEach((member) => {
        const bucket = index.get(member.id);
        if (bucket) bucket.push(group);
        else index.set(member.id, [group]);
      });
    });
    index.forEach((groups) => groups.sort((left, right) =>
      TYPE_PRIORITY.indexOf(left.type) - TYPE_PRIORITY.indexOf(right.type)));
    groupsByWord = index;
  }
  return groupsByWord.get(wordId) ?? [];
};

/**
 * 提前把索引建好。整份分组要扫全表跑正则,实测 112ms(桌面浏览器,手机上更久) ——
 * 学习页第一张卡如果在渲染里同步撞上这一下,就是肉眼可见的一顿。
 * 所以进页面时先在 setTimeout(0) 里建好,和疑难辨析页同一个套路。
 */
export const warmConfusionGroups = (): void => {
  confusionGroupsForWord(0);
};
