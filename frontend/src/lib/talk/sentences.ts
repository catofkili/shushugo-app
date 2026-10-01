import type { TalkContent } from "./content";

/** 完整音频句子：场景全部台词 + 每条公式的每组候选，去重。骨架、提示、引语只供注音。 */
export function talkAudioSentences(content: TalkContent): string[] {
  const sentences = new Set(content.scenes.flatMap((scene) => scene.lines.map((line) => line.ja)));
  for (const formula of content.formulas) for (const group of formula.fillers) {
    sentences.add(formula.pattern.replace(/\[([^\]]+)\]/gu, (_, slot: string) => group[slot].ja));
  }
  return [...sentences];
}
