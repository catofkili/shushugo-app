import { firstValue, rowsFor } from "../study-core";
import { talkContent, type TalkFormula, type TalkFiller } from "./content";

export type TalkHintLevel = 0 | 1 | 2 | 3;

export interface TalkCard {
  key: string;
  kind: "formula" | "reply";
  sceneId?: string;
  sceneTitle?: string;
  image?: string;
  prompt: string;
  partnerLine?: { speaker: string; ja: string; zh: string };
  hints: string[];
  answer: { ja: string; zh: string };
  note?: string;
  filler?: string;
}

export interface TalkCardOptions {
  random?: () => number;
}

export const allCardKeys = (): string[] => {
  const content = talkContent();
  if (!content) return [];
  return [
    ...content.formulas.map((formula) => `f:${formula.id}`),
    ...content.scenes.flatMap((scene) => scene.lines.flatMap((line, index) => line.self ? [`r:${scene.id}:${index}`] : []))
  ];
};

export const newCardOrder = (): string[] => {
  const content = talkContent();
  if (!content) return [];
  const remaining = new Set(content.formulas.map((formula) => formula.id));
  const keys: string[] = [];
  for (const scene of content.scenes) {
    for (const line of scene.lines.filter((line) => line.self)) {
      for (const id of line.formulas) {
        if (remaining.delete(id)) keys.push(`f:${id}`);
      }
    }
    scene.lines.forEach((line, index) => {
      if (line.self) keys.push(`r:${scene.id}:${index}`);
    });
  }
  return [...keys, ...[...remaining].sort().map((id) => `f:${id}`)];
};

const slotNames = (formula: TalkFormula): string[] => [...new Set([...formula.pattern.matchAll(/\[([^\]]+)\]/gu)].map((match) => match[1]))];
const fillerText = (formula: TalkFormula, group: Record<string, TalkFiller>): string => slotNames(formula).map((slot) => group[slot].ja).join("/");
const answerStart = (answer: string): string => {
  const chars = [...answer];
  return `${chars.slice(0, Math.max(2, Math.ceil(chars.length * 0.4))).join("")}…`;
};

const pickFillers = (formula: TalkFormula, key: string, random: () => number): Record<string, TalkFiller> | null => {
  if (!formula.fillers.length) return null;
  const wordIds = [...new Set(formula.fillers.flatMap((group) => Object.values(group).flatMap((word) => word.wordId === undefined ? [] : [word.wordId])))];
  const learned = new Set(wordIds.length ? rowsFor(`SELECT word_id FROM progress WHERE seen_count > 0 AND word_id IN (${wordIds.map(() => "?").join(",")})`, wordIds).map((row) => Number(row.word_id)) : []);
  const learnedGroups = formula.fillers.filter((group) => {
    const ids = Object.values(group).flatMap((word) => word.wordId === undefined ? [] : [word.wordId]);
    return ids.length > 0 && ids.every((id) => learned.has(id));
  });
  const previous = firstValue<number>("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'talk_reviews'", [], 0)
    ? firstValue<string | null>("SELECT filler FROM talk_reviews WHERE card_key = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1", [key], null)
    : null;
  let candidates = learnedGroups.length ? learnedGroups : formula.fillers;
  if (formula.fillers.length > 1 && previous !== null) {
    // 仅有的一组熟词刚用过时，回退到其它组，避免把同一张公式背成固定句子。
    const unused = candidates.filter((group) => fillerText(formula, group) !== previous);
    const alternatives = formula.fillers.filter((group) => fillerText(formula, group) !== previous);
    candidates = unused.length ? unused : alternatives.length ? alternatives : candidates;
  }
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
};

export const talkCard = (key: string, options: TalkCardOptions = {}): TalkCard | null => {
  const content = talkContent();
  if (!content) return null;
  if (key.startsWith("f:")) {
    const formula = content.formulas.find((formula) => `f:${formula.id}` === key);
    if (!formula) return null;
    const group = pickFillers(formula, key, options.random ?? Math.random);
    if (!group) return null;
    const fillJa = (text: string) => text.replace(/\[([^\]]+)\]/gu, (_match, slot: string) => group[slot].ja);
    const prompt = formula.prompt.replace(/\{([^}]+)\}/gu, (_match, slot: string) => group[slot].zh);
    const answer = fillJa(formula.pattern);
    const scene = content.scenes.find((scene) => scene.id === formula.scene);
    return {
      key,
      kind: "formula",
      ...(formula.scene ? { sceneId: formula.scene, sceneTitle: scene?.title, image: `/talk/scenes/${formula.scene}.jpg` } : {}),
      prompt,
      hints: [fillJa(formula.skeleton), answerStart(answer)],
      answer: { ja: answer, zh: prompt },
      note: formula.note,
      filler: fillerText(formula, group)
    };
  }
  const match = /^r:([^:]+):(0|[1-9]\d*)$/u.exec(key);
  if (!match) return null;
  const scene = content.scenes.find((scene) => scene.id === match[1]);
  const index = Number(match[2]);
  const line = scene?.lines[index];
  if (!scene || !line?.self) return null;
  const previous = scene.lines[index - 1];
  const partnerLine = previous && !previous.self ? { speaker: previous.speaker, ja: previous.ja, zh: previous.zh } : undefined;
  return {
    key,
    kind: "reply",
    sceneId: scene.id,
    sceneTitle: scene.title,
    image: `/talk/scenes/${scene.id}.jpg`,
    prompt: partnerLine ? "接着对方的话回答。" : line.zh,
    ...(partnerLine ? { partnerLine } : {}),
    hints: [...(partnerLine ? [`${partnerLine.ja}\n${partnerLine.zh}`] : []), line.zh, answerStart(line.ja)],
    answer: { ja: line.ja, zh: line.zh },
    note: scene.note
  };
};
