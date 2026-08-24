import type { WordCard } from "../../types/vocabulary";
import { confusionGroupsForWord, displayForm, TYPE_META } from "../confusion-groups";
import { distinctionReviewFor, type DistinctionLevel } from "../../data/confusion_distinction_reviews";

/**
 * 一张词卡上「和它容易混的东西」的统一模型。
 *
 * 音形相近只来自 confusion.ts；需要人工说明的区别统一来自
 * confusion_distinction_reviews.ts，避免同一组词在不同入口各写一套模板话。
 * similar_meaning_groups 仍保留少量高价值敬语和用法组，但只把它的人工成员和摘要接入这里；
 * 题面首义撞车继续只服务排片，不伪装成词义辨析。
 *
 * 这里把需要展示的人工辨析和七类分组合成一串 section，顺序 = 说法从具体到笼统：
 * 手写辨析 → 七类分组 → 音形相近。读音相似只展示事实，不额外编造区别。
 *
 * **刻意不接 FSRS。** 气泡里答案是全露着的，此时给评分等于告诉 FSRS「这词记住了」，
 * 正是排片规则把同组词隔开 12 张要防的那件事（见 CLAUDE.md）。能留下的状态只有
 * 疑难辨析那个「已掌握」布尔量，且只有真正来自 confusion-groups 的组才有 key 可记。
 */
export interface DistinctionMember {
  /** 0 = 词库里没有这个词条（硬编码的辨析项），不能跳过去答 */
  id: number;
  /** 卡面词形，已按 displayForm 口径清理过 */
  word: string;
  kana: string;
  meaning: string;
  exampleJp: string;
  exampleMeaning: string;
  jlptLevel: string;
  /** 手写组给这个词的单独说明 */
  note: string;
  /** 就是当前这张卡本身 —— 对照要有参照物，它得留在列表里并且标出来 */
  isCurrent: boolean;
}

export interface DistinctionSection {
  /** 「已掌握」按它记；非 confusion-groups 来源的 key 只用来做 React key */
  key: string;
  name: string;
  emoji: string;
  /** 人工写的区别；同音、同表记异读等只展示成员时为空。 */
  summary: string;
  /** 黑色 = 通常可互换；红色 = 不能自由互换；纯读音/事实组为空。 */
  level: DistinctionLevel | null;
  members: DistinctionMember[];
  /** 只有 confusion-groups 的组能标已掌握，和疑难辨析页共用同一张表 */
  masterable: boolean;
}

const currentMember = (card: WordCard): DistinctionMember => ({
  id: card.id,
  word: displayForm({ kanji: card.kanji, kana: card.kana }),
  kana: card.kana,
  meaning: card.meaning,
  exampleJp: card.example?.jp ?? "",
  exampleMeaning: card.example?.meaning ?? "",
  jlptLevel: card.jlptLevel,
  note: "",
  isCurrent: true
});

const plainMember = (
  item: { id?: number; kanji: string; kana: string; meaning: string; note?: string }
): DistinctionMember => ({
  id: Number(item.id ?? 0),
  word: displayForm(item),
  kana: item.kana,
  meaning: item.meaning,
  exampleJp: "",
  exampleMeaning: "",
  jlptLevel: "",
  // note 和 meaning 一样时说明手写组没给单独说法（自动组就是这样），别重复显示一遍
  note: item.note && item.note !== item.meaning ? item.note : "",
  isCurrent: false
});

export function wordDistinctions(card: WordCard): DistinctionSection[] {
  const sections: DistinctionSection[] = [];
  // 同一个词可以有多个混淆理由，但一张卡上只说最具体的那一个 ——
  // 「見つかる / 見つける」在自他动词组里说过了，就不再在音形相近里出现一次。
  const listedIds = new Set<number>();
  const listedForms = new Set<string>();
  const push = (section: DistinctionSection) => {
    // 同一段和相邻段都按「显示出来的词形 + 读音」去重；id 只是同一词条的补充。
    // 这能挡住历史重复行，也能避免一张卡连续出现两个完全相同的答案。
    const seen = new Set<string>();
    const uniqueMembers = section.members.filter((member) => {
      const key = `${member.word}|${member.kana}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const currentForms = new Set(
      uniqueMembers.filter((member) => member.isCurrent).map((member) => `${member.word}|${member.kana}`)
    );
    const members = uniqueMembers.filter((member) => {
      if (member.isCurrent) return true;
      const form = `${member.word}|${member.kana}`;
      return !currentForms.has(form)
        && (member.id <= 0 || !listedIds.has(member.id))
        && !listedForms.has(form);
    });
    if (!members.some((member) => !member.isCurrent)) return;
    sections.push({ ...section, members });
    members.forEach((member) => {
      if (member.isCurrent) return;
      if (member.id > 0) listedIds.add(member.id);
      listedForms.add(`${member.word}|${member.kana}`);
    });
  };

  const similar = card.similarMeaning;
  if (similar && similar.source === "manual") {
    // manual 组里的自动题面撞车成员没有人工区别，不能套用手写摘要。
    const manualItems = similar.items.filter((item) => item.manual !== false);
    push({
      key: `manual:${similar.title}`,
      name: "释义辨析",
      emoji: "📝",
      summary: similar.distinction,
      level: "major",
      members: [currentMember(card), ...manualItems.map((item) => plainMember({ ...item, note: "" }))],
      masterable: false
    });
  }

  confusionGroupsForWord(card.id).forEach((group) => {
    const meta = TYPE_META[group.type];
    const review = distinctionReviewFor(group.key);
    push({
      key: group.key,
      name: meta.name,
      emoji: meta.emoji,
      summary: review?.summary ?? "",
      level: review?.level ?? null,
      // 不按「学没学过」筛。分组里的成员是语言事实，仍要完整展示；只过滤当前卡
      // 在前面更具体的辨析里已经看过的词，避免一个词在一张展开卡里重复出现。
      members: group.members.map((member) => ({
          id: member.id,
          word: displayForm(member),
          kana: member.kana,
          meaning: member.meaning,
          exampleJp: member.exampleJp,
          exampleMeaning: member.exampleMeaning,
          jlptLevel: member.jlptLevel,
          note: "",
          isCurrent: member.id === card.id
        })),
      masterable: true
    });
  });

  // 音形相近是最后一档、也是最弱的一档：只列事实，不写一段泛泛的区别。
  const soundItems = card.confusions.filter((item) => item.kind === "sound" && !listedIds.has(item.id));
  if (soundItems.length) {
    push({
      key: `sound:${card.id}`,
      name: "音形相近",
      emoji: "👀",
      summary: "",
      level: null,
      members: [currentMember(card), ...soundItems.map(plainMember)],
      masterable: false
    });
  }

  return sections;
}
