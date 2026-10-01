import type { TalkContent } from "./content";

/** 完整音频句子：场景全部台词 + 每条公式的每组候选，去重。骨架、提示、引语只供注音。 */
export function talkAudioSentences(content: TalkContent): string[] {
  const sentences = new Set(content.scenes.flatMap((scene) => scene.lines.map((line) => line.ja)));
  for (const formula of content.formulas) for (const group of formula.fillers) {
    sentences.add(formula.pattern.replace(/\[([^\]]+)\]/gu, (_, slot: string) => group[slot].ja));
  }
  return [...sentences];
}

/** 公式骨架露出的开头（「お水を ……」→「お水を」）；骨架以「……」开头、或者露出的不是答案开头时为 0。 */
export function skeletonRevealed(skeleton: string, answer: string): number {
  const cut = skeleton.indexOf("……");
  const prefix = (cut < 0 ? skeleton : skeleton.slice(0, cut)).trimEnd();
  return prefix && answer.startsWith(prefix) ? prefix.length : 0;
}

/**
 * 「开头几个字」提示露到哪（UTF-16 下标）。卡片和注音表必须用同一个切点，所以放在这里两边共用。
 * - 前面没露过（after = 0）：答案的 40%，至少 2 个字。
 * - 骨架已经露了开头（after > 0）：在它后面再露剩下的一半，至少 2 个字——原来一律 40%，
 *   294 组公式里 240 组的第 2 条提示只比第 1 条多 0–1 个字，点了等于白扣一档。
 * - 永远留最后一个字（通常是「。」以外的内容），不把整句露光；不把一块注音汉字切成两半（領収書 → 領収）。
 */
export function hintEnd(answer: string, annotations: ReadonlyArray<{ start: number; length: number }>, after = 0): number {
  const chars = [...answer];
  const shown = [...answer.slice(0, after)].length;
  const want = shown === 0
    ? Math.max(2, Math.ceil(chars.length * 0.4))
    : shown + Math.max(2, Math.ceil((chars.length - shown) * 0.5));
  let end = chars.slice(0, Math.min(want, Math.max(chars.length - 1, 1))).join("").length;
  const crossing = annotations.find((a) => a.start < end && a.start + a.length > end);
  if (crossing) end = crossing.start + crossing.length;
  return end;
}
