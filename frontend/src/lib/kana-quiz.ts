// 五十音考题：先教再考、四种题、干扰项挑真正会混的。判据和来龙去脉见
// docs/claude/daily-plans-and-study-modes.md「五十音考题（2026-10-28）」。
// 只给 KanaPrimer 用（Taro 落在 study 分包）。不进小程序共享层 web.js：kana_cards.json 有 120 KB。
import kanaCards from "../data/kana_cards.json";
import kanaConfusables from "../data/kana_confusables.json";
import { KANA, type KanaState } from "./kana-progress";

type Card = { group: string; front: string; romaji: string; pair: string; origin: string; note: string; examples: [string, string][] };
const CARDS = new Map((kanaCards.cards as unknown as Card[]).filter((card) => card.group === "seion").map((card) => [card.front, card]));
const ROMAJI = new Map<string, string>(KANA.map(([kana, romaji]) => [kana, romaji]));
const SYMBOLS: string[] = KANA.map(([kana]) => kana);
const LOOKALIKE = new Map(kanaConfusables.pairs.flatMap((group) => group.map((kana) => [kana, group.filter((other) => other !== kana)] as const)));
// 读词题的词：全部清音卡的例词里，只由清音组成的那些（带濁点、小字、ー 的等学到再说）。
// 去掉 を（词里读 o，罗马字却写 wo）和「ん+元音/や行」（Hepburn 要写 n'，逐字拼会出错）。
const WORDS: [string, string][] = [...new Map([...CARDS.values()].flatMap((card) => card.examples)
  .filter(([word]) => word.length >= 2 && [...word].every((ch) => ROMAJI.has(ch)) && !/[をヲ]|[んン][あいうえおやゆよアイウエオヤユヨ]/.test(word))).entries()];

const romajiOf = (kana: string) => ROMAJI.get(kana)!;
const isKatakana = (kana: string) => kana >= "ァ";
const consonant = (romaji: string) => ({ shi: "s", chi: "t", tsu: "t", fu: "h", n: "n" } as Record<string, string>)[romaji] ?? romaji.slice(0, -1);
const vowel = (romaji: string) => romaji === "n" ? "" : romaji.slice(-1);
const readWord = (word: string) => [...word].map(romajiOf).join("");

const shuffle = <T,>(list: readonly T[], random: () => number): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// 干扰项：形近字全上（形近表一组最多三个，ね/れ/わ 这种三个一起才是真考点），剩下的按「同行 → 同段 → 其余」轮流取。
// 同行考元音（ka/ki），同段考辅音（ka/sa）。只在同一种假名里挑。
const neighbours = (kana: string, random: () => number): string[][] => {
  const romaji = romajiOf(kana);
  const same = SYMBOLS.filter((other) => other !== kana && isKatakana(other) === isKatakana(kana));
  return [
    ...(LOOKALIKE.get(kana) ?? []).map((other) => [other]),
    same.filter((other) => consonant(romajiOf(other)) === consonant(romaji)),
    same.filter((other) => vowel(romajiOf(other)) === vowel(romaji)),
    same
  ].map((pool) => shuffle(pool, random));
};

const takeDistinct = (pools: string[][], answerKey: string, key: (item: string) => string, count = 3): string[] => {
  const used = new Set([answerKey]);
  const queues = pools.map((pool) => [...pool]);
  const out: string[] = [];
  while (out.length < count && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const item = queue.shift()!;
        if (used.has(key(item))) continue;
        used.add(key(item));
        out.push(item);
        break;
      }
      if (out.length === count) break;
    }
  }
  return out;
};

export type KanaQuestionType = "read" | "write" | "word" | "pair" | "listen";
export type KanaChoice = { label: string; correct: boolean; note?: string };
// sound：这道题对应的读音文件名（罗马字，平片共用一条，见 scripts/build-kana-audio.mjs）。读词题没有。
export type KanaQuestion = { symbol: string; type: KanaQuestionType; prompt: string; ask: string; choices: KanaChoice[]; reveal: string; sound?: string };
export type KanaTeach = { symbol: string; romaji: string; origin: string; pair: string; note: string; example?: [string, string] };
// rest：今天能考的都过关了，剩下的要等明天（三个不同的日子都答对才算掌握）。
export type KanaStep = { kind: "teach"; teach: KanaTeach } | { kind: "quiz"; question: KanaQuestion } | { kind: "rest"; left: number };

const wordsFor = (kana: string, introduced: ReadonlySet<string>) =>
  WORDS.filter(([word]) => word.includes(kana) && [...word].every((ch) => introduced.has(ch)));

export const buildKanaQuestion = (kana: string, type: KanaQuestionType, introduced: ReadonlySet<string>, random = Math.random): KanaQuestion =>
  type === "word" ? wordQuestion(kana, introduced, random) : { ...kanaQuestion(kana, type, random), sound: soundOf(kana) };

export const soundOf = (kana: string) => romajiOf(kana);

const kanaQuestion = (kana: string, type: Exclude<KanaQuestionType, "word">, random: () => number): KanaQuestion => {
  const romaji = romajiOf(kana);
  const script = isKatakana(kana) ? "片假名" : "平假名";
  if (type === "listen") {
    // 听音的错项只取同行（同辅音，考元音）和同段（同元音，考辅音）：形近字听起来并不像。
    const [row, column] = neighbours(kana, random).slice(LOOKALIKE.get(kana)?.length ?? 0);
    const others = takeDistinct([row, column], romaji, romajiOf);
    return { symbol: kana, type, prompt: "", ask: `听到的是哪个${script}？`, reveal: `听到的是 ${romaji}（${kana}）`,
      choices: shuffle([{ label: kana, correct: true }, ...others.map((other) => ({ label: other, correct: false, note: `${other} 读 ${romajiOf(other)}` }))], random) };
  }
  if (type === "read") {
    const others = takeDistinct(neighbours(kana, random), romaji, romajiOf);
    return { symbol: kana, type, prompt: kana, ask: "读什么？", reveal: `${kana} 读 ${romaji}`,
      choices: shuffle([{ label: romaji, correct: true }, ...others.map((other) => ({ label: romajiOf(other), correct: false, note: `${romajiOf(other)} 是 ${other}` }))], random) };
  }
  if (type === "write") {
    const others = takeDistinct(neighbours(kana, random), romaji, romajiOf);
    return { symbol: kana, type, prompt: romaji, ask: `哪个${script}读 ${romaji}？`, reveal: `${romaji} 是 ${kana}`,
      choices: shuffle([{ label: kana, correct: true }, ...others.map((other) => ({ label: other, correct: false, note: `${other} 读 ${romajiOf(other)}` }))], random) };
  }
  if (type === "pair") {
    const pair = CARDS.get(kana)!.pair;
    const others = takeDistinct(neighbours(pair, random), romajiOf(pair), romajiOf);
    const target = isKatakana(kana) ? "平假名" : "片假名";
    return { symbol: kana, type, prompt: kana, ask: `对应的${target}是？`, reveal: `${kana} 和 ${pair} 都读 ${romaji}`,
      choices: shuffle([{ label: pair, correct: true }, ...others.map((other) => ({ label: other, correct: false, note: `${other} 读 ${romajiOf(other)}` }))], random) };
  }
  throw new Error(`未知题型 ${type}`);
};

const wordQuestion = (kana: string, introduced: ReadonlySet<string>, random: () => number): KanaQuestion => {
  const type = "word";
  const [word, meaning] = shuffle(wordsFor(kana, introduced), random)[0];
  const answer = readWord(word);
  // 读词的错项：把词里的一个假名换成它的形近 / 同行 / 同段字。先换本题这个字，再换别的位置。
  const chars = [...word];
  const positions = [...chars.keys()].sort((a, b) => Number(chars[b] === kana) - Number(chars[a] === kana));
  const variants = positions.map((at) => neighbours(chars[at], random).flat()
    .map((other) => chars.map((ch, i) => i === at ? other : ch).join("")));
  const others = takeDistinct(variants, answer, readWord);
  return { symbol: kana, type, prompt: word, ask: "这个词怎么读？", reveal: `${word} 读 ${answer}，「${meaning}」`,
    choices: shuffle([{ label: answer, correct: true }, ...others.map((other) => {
      const at = [...other].findIndex((ch, i) => ch !== chars[i]);
      return { label: readWord(other), correct: false, note: `${readWord(other)} 是把 ${chars[at]} 认成了 ${[...other][at]}` };
    })], random) };
};

// 题型：第一次学的那天，第一题看字选读音（认得出），第二题换方向（分得清）——看读音挑字 / 听音选字 / 读词 / 平片对应。
// 隔天重考和回炉都从「分得清」那几种里抽，一题过关。
const typeFor = (kana: string, state: KanaState | undefined, introduced: ReadonlySet<string>, random: () => number): KanaQuestionType => {
  const firstDay = !state || state.stage === "new" || state.stage === "learning";
  if (firstDay && (state?.todayCorrect ?? 0) === 0) return "read";
  const pair = CARDS.get(kana)!.pair;
  const types: KanaQuestionType[] = ["write", "listen"];
  if (wordsFor(kana, introduced).length) types.push("word");
  if (isKatakana(kana) && introduced.has(pair)) types.push("pair");
  return types[Math.floor(random() * types.length)];
};

const LEARNING_SIZE = 4;
const REVISIT_SHARE = 0.15;

/**
 * 下一步做什么。states 来自 kana-progress 的 getKanaStates（掌握口径在那里）；
 * introduced = 教过或答过的字；recent = 最近出过的两个字（不连着出）。
 * - 今天第一次学、还没过关的字少于 4 个，就按表序教下一个新字（新字每天照常教，不等隔天重考做完）。
 * - 出题在「今天第一次学的」和「之前学过、今天待重考的」两堆里各半随机；约 15% 回炉今天已过关的字，已掌握的不再出。
 * - 全部掌握返回 null；今天能考的都过了、剩下要等明天，返回 rest。
 */
export const nextKanaStep = (states: Record<string, KanaState>, introduced: ReadonlySet<string>, recent: readonly string[], random = Math.random): KanaStep | null => {
  const stage = (kana: string) => states[kana]?.stage ?? "new";
  if (SYMBOLS.every((kana) => stage(kana) === "mastered")) return null;
  const fresh = SYMBOLS.filter((kana) => stage(kana) === "new" && !introduced.has(kana));
  const learning = SYMBOLS.filter((kana) => stage(kana) === "learning" || (stage(kana) === "new" && introduced.has(kana)));
  const review = SYMBOLS.filter((kana) => stage(kana) === "review");
  const ready = (list: string[]) => list.filter((kana) => !recent.includes(kana));
  const [readyLearning, readyReview] = [ready(learning), ready(review)];
  if (fresh.length && (learning.length < LEARNING_SIZE || (!readyLearning.length && !readyReview.length))) {
    const card = CARDS.get(fresh[0])!;
    return { kind: "teach", teach: { symbol: card.front, romaji: card.romaji, origin: card.origin, pair: card.pair, note: card.note, example: card.examples[0] } };
  }
  if (!learning.length && !review.length && !fresh.length) return { kind: "rest", left: SYMBOLS.filter((kana) => stage(kana) !== "mastered").length };
  // 已掌握的字不再回炉（「视情况五十音不再出现，毕竟是入门课」，2026-10-28 用户）；只回炉今天刚过关的。
  const revisit = ready(SYMBOLS.filter((kana) => stage(kana) === "passed"));
  const due = readyLearning.length && readyReview.length ? (random() < 0.5 ? readyReview : readyLearning) : readyLearning.length ? readyLearning : readyReview;
  const pool = revisit.length && (!due.length || random() < REVISIT_SHARE) ? revisit : due.length ? due : [...learning, ...review];
  const kana = pool[Math.floor(random() * pool.length)];
  return { kind: "quiz", question: buildKanaQuestion(kana, typeFor(kana, states[kana], introduced, random), introduced, random) };
};
