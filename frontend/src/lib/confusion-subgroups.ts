import { CONFUSION_SUBGROUPS } from "../data/confusion_subgroups";
import type { Transitivity } from "./transitivity";

/**
 * 一组词按手写小组排好位置、带上自他。三处（辨析卡答案面、疑难辨析页大卡、学习页辨析气泡）
 * 都走这里，别各自再写一遍「哪个词归哪个小组」。
 *
 * 没有手写小组的组：一个无标题小组，自他走调用方给的兜底（自他对的配对表、JMdict 表）。
 * 手写稿没认领到的成员（词库后来加了词）排在最后、不带标题 —— 宁可少一个框，也不能把词丢掉。
 */
export interface PlacedMember<T> {
  member: T;
  voice: Transitivity | null;
  /** 小组标题；空串 = 不分小组 */
  subgroup: string;
}

/**
 * formsOf 按优先级排（卡面词形在前）。必须逐级找：止 组里 やめる 的 kanji 也是「止める」，
 * 一把 includes 会让「止める」这个键先认领到 やめる 那行。
 */
export const matchIndex = <T>(members: readonly T[], form: string, formsOf: (member: T) => readonly string[]): number => {
  const depth = Math.max(0, ...members.map((member) => formsOf(member).length));
  for (let level = 0; level < depth; level += 1) {
    const index = members.findIndex((member) => formsOf(member)[level] === form);
    if (index >= 0) return index;
  }
  return -1;
};

export const placeMembers = <T>(
  groupKey: string,
  members: readonly T[],
  formsOf: (member: T) => readonly string[],
  fallbackVoice: (member: T) => Transitivity | null
): PlacedMember<T>[] => {
  const subgroups = CONFUSION_SUBGROUPS[groupKey];
  if (!subgroups) return members.map((member) => ({ member, voice: fallbackVoice(member), subgroup: "" }));
  const left = [...members];
  const placed = subgroups.flatMap((subgroup) => Object.entries(subgroup.words).flatMap(([form, voice]) => {
    const index = matchIndex(left, form, formsOf);
    if (index < 0) return [];
    const [member] = left.splice(index, 1);
    // 手写的空串 = 非动词，不去兜底表里猜
    return [{ member, voice: voice || null, subgroup: subgroup.title }];
  }));
  return [...placed, ...left.map((member) => ({ member, voice: fallbackVoice(member), subgroup: "" }))];
};

/** 把排好的成员切成连续的小组。只有一个无标题小组 = 这组不分小组，界面照旧平铺。 */
export const subgroupRuns = <T extends { subgroup: string }>(items: readonly T[]): { title: string; items: T[] }[] =>
  items.reduce<{ title: string; items: T[] }[]>((runs, item) => {
    const last = runs[runs.length - 1];
    if (last && last.title === item.subgroup) last.items.push(item);
    else runs.push({ title: item.subgroup, items: [item] });
    return runs;
  }, []);

export const pairRoleVoice = (role: "自动词" | "他动词" | undefined): Transitivity | null =>
  role === "自动词" ? "自" : role === "他动词" ? "他" : null;
