import type { TokenMorph } from "../types/furigana";
import verbPairHints from "../data/verb_pair_hints.ts";

type VerbPairHint = [string, string, string, string];
const VERB_PAIR_HINTS = verbPairHints as unknown as Record<string, VerbPairHint>;
const toHiragana = (value: string) => value.replace(/[ァ-ヶ]/gu, (char) => (
  String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
));

// Build kana pairs from the reciprocal entries as well.  This catches
// orthographic variants such as 空ける↔空く even when the hint table stores
// the more common 開ける↔開く spelling.
const VERB_PAIR_READING_PAIRS = new Set<string>();
Object.entries(VERB_PAIR_HINTS).forEach(([, hint]) => {
  const pairedKanji = hint?.[1];
  const pairedReading = hint?.[2];
  if (!pairedKanji || !pairedReading) return;
  const reverse = VERB_PAIR_HINTS[pairedKanji];
  if (!reverse?.[2]) return;
  const leftReading = toHiragana(reverse[2]);
  const rightReading = toHiragana(pairedReading);
  VERB_PAIR_READING_PAIRS.add(`${leftReading}\u001f${rightReading}`);
  VERB_PAIR_READING_PAIRS.add(`${rightReading}\u001f${leftReading}`);
});

export interface ConjugationStep {
  label: string;
  from: string;
  to: string;
  note: string;
}

export interface ConjugationExplanation {
  label: string;
  rule: string;
  /** Present for a validated compound chain; simple forms keep the old shape. */
  steps?: ConjugationStep[];
}

export interface ConjugationInput {
  surface: string;
  lemma: string;
  dictionaryForm: string;
  verbType: string;
  pos: string;
  morphs?: TokenMorph[];
  reading?: string;
  dictionaryReading?: string;
}

const GODAN_I: Record<string, string> = {
  う: "い", く: "き", ぐ: "ぎ", す: "し", つ: "ち", ぬ: "に", ぶ: "び", む: "み", る: "り"
};
const GODAN_A: Record<string, string> = {
  う: "わ", く: "か", ぐ: "が", す: "さ", つ: "た", ぬ: "な", ぶ: "ば", む: "ま", る: "ら"
};
const GODAN_E: Record<string, string> = {
  う: "え", く: "け", ぐ: "げ", す: "せ", つ: "て", ぬ: "ね", ぶ: "べ", む: "め", る: "れ"
};
const GODAN_TE: Record<string, string> = {
  う: "って", つ: "って", る: "って", む: "んで", ぶ: "んで",
  ぬ: "んで", く: "いて", ぐ: "いで", す: "して"
};
const GODAN_TA: Record<string, string> = {
  う: "った", つ: "った", る: "った", む: "んだ", ぶ: "んだ",
  ぬ: "んだ", く: "いた", ぐ: "いだ", す: "した"
};

const clean = (value: string) => String(value ?? "").replace(/[\s]/gu, "");
const lastKana = (value: string) => {
  const chars = [...value];
  return chars[chars.length - 1] ?? "";
};
const head = (value: string) => [...value].slice(0, -1).join("");
const replaceLast = (value: string, replacement: string) => `${head(value)}${replacement}`;

const verbClass = (verbType: string) => {
  if (verbType === "godan") return "五段动词";
  if (verbType === "ichidan") return "一段动词";
  if (verbType === "suru") return "サ变动词";
  if (verbType === "kuru") return "カ变动词";
  return "动词";
};

const isVerb = (pos: string) => pos.includes("动词") || pos.includes("動詞");

const godanStem = (lemma: string, table: Record<string, string>) => {
  const tail = lastKana(lemma);
  return table[tail] ? replaceLast(lemma, table[tail]) : null;
};

const verbI = (lemma: string, verbType: string) => {
  if (verbType === "godan") return godanStem(lemma, GODAN_I);
  if (verbType === "ichidan" && lemma.endsWith("る")) return lemma.slice(0, -1);
  if (verbType === "suru" || lemma === "する") return lemma.endsWith("する") ? `${lemma.slice(0, -2)}し` : "し";
  if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return lemma === "くる" ? "き" : "来";
  return null;
};

const verbA = (lemma: string, verbType: string) => {
  if (verbType === "godan") return godanStem(lemma, GODAN_A);
  if (verbType === "ichidan" && lemma.endsWith("る")) return lemma.slice(0, -1);
  if (verbType === "suru" || lemma === "する") return lemma.endsWith("する") ? `${lemma.slice(0, -2)}し` : "し";
  if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return "来";
  return null;
};

const verbE = (lemma: string, verbType: string) => {
  if (verbType === "godan") return godanStem(lemma, GODAN_E);
  if (verbType === "ichidan" && lemma.endsWith("る")) return lemma.slice(0, -1);
  if (verbType === "suru" || lemma === "する") return lemma.endsWith("する") ? `${lemma.slice(0, -2)}でき` : "でき";
  if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return "来られ";
  return null;
};

const teTa = (lemma: string, verbType: string, kind: "て形" | "た形") => {
  if ((lemma === "行く" || lemma === "いく") && kind === "て形") return "行って";
  if ((lemma === "行く" || lemma === "いく") && kind === "た形") return "行った";
  const map = kind === "て形" ? GODAN_TE : GODAN_TA;
  if (verbType === "godan") {
    const tail = lastKana(lemma);
    return map[tail] ? `${head(lemma)}${map[tail]}` : null;
  }
  if (verbType === "ichidan" && lemma.endsWith("る")) return `${lemma.slice(0, -1)}${kind === "て形" ? "て" : "た"}`;
  if (verbType === "suru" || lemma === "する") return `${lemma.endsWith("する") ? lemma.slice(0, -2) : ""}${kind === "て形" ? "して" : "した"}`;
  if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return kind === "て形" ? "来て" : "来た";
  return null;
};

const politeStemRule = (lemma: string, verbType: string, ending: string) => {
  const group = verbClass(verbType);
  const stem = verbI(lemma, verbType);
  if (stem) {
    if (verbType === "godan") return `${lemma}是${group}：词尾「${lastKana(lemma)}」变成い段「${lastKana(stem)}」，再接「${ending}」。`;
    if (verbType === "ichidan") return `${lemma}是一段动词：去掉词尾「る」，再接「${ending}」。`;
    if (verbType === "suru" || lemma.endsWith("する")) return `「する」变为「し」，再接「${ending}」。`;
    if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return `「来る」变为「来（き）」，再接「${ending}」。`;
  }
  return `${group}先变为连用形，再接「${ending}」。`;
};

const negativeRule = (lemma: string, verbType: string, ending: string) => {
  const group = verbClass(verbType);
  const stem = verbA(lemma, verbType);
  if (stem) {
    if (verbType === "godan") return `${lemma}是${group}：词尾「${lastKana(lemma)}」变成あ段「${lastKana(stem)}」，再接「${ending}」。`;
    if (verbType === "ichidan") return `${lemma}是一段动词：去掉「る」，再接「${ending}」。`;
    if (verbType === "suru" || lemma.endsWith("する")) return `「する」的否定词干是「し」，接「${ending}」。`;
    if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return `「来る」的否定形使用「来（こ）」，接「${ending}」。`;
  }
  return `${group}先变为未然形，再接「${ending}」。`;
};

const teTaRule = (lemma: string, verbType: string, kind: "て形" | "た形") => {
  const form = teTa(lemma, verbType, kind);
  if (form) {
    if ((lemma === "行く" || lemma === "いく")) return `「行く」是特殊音便：变为「${form}」。`;
    if (verbType === "godan") return `${lemma}是五段动词：词尾「${lastKana(lemma)}」按音便规则变为「${form.slice(head(lemma).length)}」。`;
    if (verbType === "ichidan") return `${lemma}是一段动词：去掉「る」，接「${kind === "て形" ? "て" : "た"}」。`;
    if (verbType === "suru" || lemma.endsWith("する")) return `「する」变为「${form}」。`;
    if (verbType === "kuru" || lemma === "来る" || lemma === "くる") return `「来る」变为「${kind === "て形" ? "来て（きて）" : "来た（きた）"}」。`;
  }
  return `先变成${kind}；这里的具体形态是「${kind === "て形" ? "～て／～で" : "～た／～だ"}」。`;
};

export const potentialDictionaryCandidates = (text: string): string[] => {
  const value = clean(text);
  const candidates: string[] = [];
  if (value.endsWith("られる") && value.length > 3) candidates.push(`${value.slice(0, -3)}る`);
  if (value.endsWith("る") && value.length > 1) {
    const potentialStem = value.slice(0, -1);
    const tail = lastKana(potentialStem);
    const godanOriginal = Object.entries(GODAN_E).find(([, e]) => e === tail)?.[0];
    if (godanOriginal) candidates.push(replaceLast(potentialStem, godanOriginal));
  }
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
};

/**
 * Return the reading a dictionary verb would have in its potential form.
 * Recovery is only safe when this agrees with the clicked token's reading:
 * 空く→空ける, but 空く(すく)→すける, not 空ける(あける).
 */
export const potentialReadingCandidates = (dictionaryReading: string, verbType: string): string[] => {
  const reading = toHiragana(clean(dictionaryReading));
  if (!reading) return [];
  let full = "";
  if (verbType === "godan") {
    const stem = godanStem(reading, GODAN_E);
    full = stem ? `${stem}る` : "";
  } else if (verbType === "ichidan" && reading.endsWith("る")) {
    full = `${reading.slice(0, -1)}られる`;
  } else if (verbType === "suru" || reading === "する") {
    full = "できる";
  } else if (verbType === "kuru" || reading === "くる") {
    full = "こられる";
  }
  if (!full) return [];
  const stem = full.endsWith("る") ? full.slice(0, -1) : full;
  const suffixes = [
    "", "ます", "ません", "ました", "ませんでした", "ない", "なかった", "なければ", "なくて",
    "て", "た", "たら", "ている", "ています", "ていた", "ていました", "ていない", "ていません",
    "てしまう", "てしまいます", "てしまった", "てしまいました"
  ];
  return [stem, ...suffixes.map((suffix) => `${stem}${suffix}`), full];
};

export const isPotentialReadingCompatible = (
  surfaceReading: string,
  dictionaryReading: string,
  verbType: string
): boolean => {
  const target = toHiragana(clean(surfaceReading));
  return Boolean(target) && potentialReadingCandidates(dictionaryReading, verbType).some((candidate) => (
    target === candidate
      || (target.startsWith(candidate) && [...target.slice(candidate.length)].length <= 6)
  ));
};

/**
 * A kana-shaped え段＋る string is not enough evidence for a potential form:
 * 開ける/開く, 閉める/閉まる and many other 自他動詞 pairs have exactly the
 * same surface pattern.  The hint table is authoritative for the pairs it
 * knows; recovery must never turn one member into the other's conjugation.
 */
export const isKnownVerbPair = (
  left: string,
  right: string,
  leftReading = "",
  rightReading = ""
): boolean => {
  const normalizedLeft = clean(left);
  const normalizedRight = clean(right);
  if (!normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight) return false;
  const matches = (key: string, other: string) => {
    const hint = VERB_PAIR_HINTS[key];
    if (!Array.isArray(hint)) return false;
    return hint.slice(1, 3).some((value) => clean(value) === other);
  };
  if (matches(normalizedLeft, normalizedRight) || matches(normalizedRight, normalizedLeft)) return true;
  if (!leftReading || !rightReading) return false;
  const leftKana = toHiragana(clean(leftReading));
  const rightKana = toHiragana(clean(rightReading));
  return VERB_PAIR_READING_PAIRS.has(`${leftKana}\u001f${rightKana}`);
};

type Candidate = { output: string; label: string; rule: string };

const morphConfirmsPotential = (morphs: TokenMorph[] | undefined, dictionaryForm: string) => {
  const first = morphs?.[0];
  if (!first) return false;
  if (/可能/u.test(`${first.conjugatedType ?? ""}${first.conjugatedForm ?? ""}`)) return true;
  // Kuromoji treats a form such as 使えます as an 一段 verb whose first
  // morph lemma is the え段＋る form (使える).  If that lemma reverses to
  // the dictionary verb we recovered, the potential reading is confirmed;
  // there is no need to label it as a guess.
  return /一段/u.test(first.conjugatedType ?? "")
    && potentialDictionaryCandidates(first.lemma).includes(clean(dictionaryForm));
};

const potentialBaseForm = (lemma: string, dictionaryForm: string, dictionaryReading = "") => (
  [dictionaryForm, dictionaryReading]
    .map(clean)
    .filter(Boolean)
    .find((candidate) => potentialDictionaryCandidates(lemma).includes(candidate)) ?? null
);

const publicCandidate = (candidate: Candidate | null): ConjugationExplanation | null => (
  candidate ? { label: candidate.label, rule: candidate.rule } : null
);

const match = (surface: string, output: string, label: string, rule: string): Candidate | null => (
  output === surface ? { output, label, rule } : null
);

const potentialCandidate = (
  surface: string,
  dictionaryForm: string,
  verbType: string,
  inferred = false
): Candidate | null => {
  const full = verbType === "godan" ? `${verbE(dictionaryForm, verbType) ?? ""}る`
    : verbType === "ichidan" ? `${dictionaryForm.slice(0, -1)}られる`
      : verbType === "suru" ? `${dictionaryForm.slice(0, -2)}できる`
        : verbType === "kuru" ? "来られる" : "";
  if (!full) return null;
  const stem = full.endsWith("る") ? full.slice(0, -1) : full;
  const potentialRule = inferred
    ? `推测为「${dictionaryForm}」的可能形：变为「${full}」，表示“能够……”。`
    : `${dictionaryForm}变为可能形「${full}」，表示“能够……”。`;
  const potentialLabel = inferred ? "可能形（推测）" : "可能形";
  const candidates: Array<Candidate | null> = [
    match(surface, full, potentialLabel, potentialRule),
    match(surface, `${stem}ます`, `${potentialLabel}＋敬体`, `${potentialRule} 再去掉「る」，接「ます」。`),
    match(surface, `${stem}ません`, `${potentialLabel}＋敬体否定`, `${potentialRule} 再去掉「る」，接「ません」。`),
    match(surface, `${stem}ました`, `${potentialLabel}＋敬体过去`, `${potentialRule} 再去掉「る」，接「ました」。`),
    match(surface, `${stem}ませんでした`, `${potentialLabel}＋敬体过去否定`, `${potentialRule} 再去掉「る」，接「ませんでした」。`),
    match(surface, `${stem}ない`, `${potentialLabel}＋否定`, `${potentialRule} 再去掉「る」，接「ない」。`),
    match(surface, `${stem}なかった`, `${potentialLabel}＋过去否定`, `${potentialRule} 再去掉「る」，接「なかった」。`)
  ];
  return candidates.find(Boolean) ?? null;
};

const simpleVerbCandidate = (
  surface: string,
  lemma: string,
  dictionaryForm: string,
  verbType: string,
  lemmaReading = "",
  dictionaryReading = "",
  inferred = true
): Candidate | null => {
  const potentialBase = potentialBaseForm(lemma, dictionaryForm, dictionaryReading);
  if (potentialBase && !isKnownVerbPair(lemma, potentialBase, lemmaReading, dictionaryReading)) {
    const potential = potentialCandidate(surface, potentialBase, verbType, inferred);
    if (potential) return potential;
  }

  const i = verbI(dictionaryForm, verbType);
  const a = verbA(dictionaryForm, verbType);
  const te = teTa(dictionaryForm, verbType, "て形");
  const ta = teTa(dictionaryForm, verbType, "た形");
  const candidates: Array<Candidate | null> = [];
  if (te) {
    const iStem = verbI(dictionaryForm, verbType);
    const aStem = verbA(dictionaryForm, verbType);
    const teStem = /て$|で$/u.test(te) ? te.slice(0, -1) : te;
    candidates.push(match(surface, iStem ?? "", "连用形", `${dictionaryForm}变为连用形「${iStem ?? ""}」。`));
    candidates.push(match(surface, aStem ?? "", "未然形", `${dictionaryForm}变为未然形「${aStem ?? ""}」。`));
    candidates.push(match(surface, teStem, "て形词干", `${dictionaryForm}先变为「${te}」的词干「${teStem}」。`));
    candidates.push(match(surface, te, "て形", teTaRule(dictionaryForm, verbType, "て形")));
    candidates.push(match(surface, `${te}いる`, "ている形（非过去）", `${teTaRule(dictionaryForm, verbType, "て形")} 再接「いる」；表示动作正在进行或结果状态持续。`));
    candidates.push(match(surface, `${te}います`, "ている形（非过去）", `${teTaRule(dictionaryForm, verbType, "て形")} 再接「いる」；表示动作正在进行或结果状态持续。`));
    candidates.push(match(surface, `${te}いた`, "ている形（过去）", `${teTaRule(dictionaryForm, verbType, "て形")} 再接「いる」；表示动作正在进行或结果状态持续。`));
    candidates.push(match(surface, `${te}いました`, "ている形（过去）", `${teTaRule(dictionaryForm, verbType, "て形")} 再接「いる」；表示动作正在进行或结果状态持续。`));
    candidates.push(match(surface, `${te}なくて`, "否定接续形", `${negativeRule(dictionaryForm, verbType, "ない")} 再接「くて」，表示“不……而……”或连接后项。`));
  }
  if (ta) candidates.push(match(surface, ta, "过去／完成（た形）", teTaRule(dictionaryForm, verbType, "た形")));
  if (i) {
    candidates.push(match(surface, `${i}ます`, "敬体非过去形", politeStemRule(dictionaryForm, verbType, "ます")));
    candidates.push(match(surface, `${i}ません`, "敬体否定形", politeStemRule(dictionaryForm, verbType, "ません")));
    candidates.push(match(surface, `${i}ました`, "敬体过去形", politeStemRule(dictionaryForm, verbType, "ました")));
    candidates.push(match(surface, `${i}ませんでした`, "敬体过去否定", politeStemRule(dictionaryForm, verbType, "ませんでした")));
  }
  if (a) {
    if ((verbType === "suru" || dictionaryForm.endsWith("する")) && dictionaryForm.endsWith("する")) {
      candidates.push(match(surface, `${dictionaryForm.slice(0, -2)}さ`, "未然形", `「する」变为未然形「${dictionaryForm.slice(0, -2)}さ」，用于受身等接续。`));
    }
    candidates.push(match(surface, `${a}ない`, "否定形（ない形）", negativeRule(dictionaryForm, verbType, "ない")));
    candidates.push(match(surface, `${a}なかった`, "否定过去形", negativeRule(dictionaryForm, verbType, "なかった")));
    candidates.push(match(surface, `${a}なければ`, "否定条件形", `${negativeRule(dictionaryForm, verbType, "ない")} 再把「ない」变为「なければ」，表示“如果不……”。`));
    candidates.push(match(surface, `${a}なくて`, "否定接续形", `${negativeRule(dictionaryForm, verbType, "ない")} 再接「くて」，表示“不……而……”或连接后项。`));
  }
  const volitional = verbType === "godan"
    ? (lastKana(dictionaryForm) === "う" ? `${head(dictionaryForm)}おう` : `${head(dictionaryForm)}${GODAN_O[lastKana(dictionaryForm)] ?? ""}`)
    : verbType === "ichidan" ? `${dictionaryForm.slice(0, -1)}よう`
      : verbType === "suru" || dictionaryForm.endsWith("する") ? `${dictionaryForm.slice(0, -2)}しよう`
        : verbType === "kuru" ? "来よう" : "";
  if (volitional) candidates.push(match(surface, volitional, "意向形", `${dictionaryForm}变为意向形，表示说话人的意志或“我们……吧”。`));
  return candidates.find(Boolean) ?? null;
};

const GODAN_O: Record<string, string> = { く: "こう", ぐ: "ごう", す: "そう", つ: "とう", ぬ: "のう", ぶ: "ぼう", む: "もう", る: "ろう" };

const auxiliaryDescription = (helper: string) => ({
  "いる": { label: "补助动词「いる」", note: "「て」后接「いる」，表示动作正在进行或状态持续。" },
  "おる": { label: "补助动词「おる」", note: "「て」后接「おる」，是较郑重或自谦的「ている」。" },
  "おく": { label: "补助动词「おく」", note: "「て」后接「おく」，表示预先做好或保持某状态。" },
  "しまう": { label: "补助动词「しまう」", note: "「て」后接「しまう」，表示动作完成，有时带遗憾语气。" },
  "みる": { label: "补助动词「みる」", note: "「て」后接「みる」，表示尝试做某事。" },
  "くる": { label: "补助动词「くる」", note: "「て」后接「くる」，表示动作朝现在或说话方发展。" },
  "いく": { label: "补助动词「いく」", note: "「て」后接「いく」，表示动作向今后发展。" },
  "もらう": { label: "补助动词「もらう」", note: "「て」后接「もらう」，表示请别人为自己做某事。" },
  "くれる": { label: "补助动词「くれる」", note: "「て」后接「くれる」，表示别人为我方做某事。" },
  "あげる": { label: "补助动词「あげる」", note: "「て」后接「あげる」，表示我方为别人做某事。" },
  "ある": { label: "补助动词「ある」", note: "「て」后接「ある」，表示动作结果保持着。" },
  "始める": { label: "复合动词「始める」", note: "接「始める」，表示开始做某事。" },
  "続ける": { label: "复合动词「続ける」", note: "接「続ける」，表示继续做某事。" },
  "出す": { label: "复合动词「出す」", note: "接「出す」，表示突然开始做某事。" },
  "切る": { label: "复合动词「切る」", note: "接「切る」，表示做到彻底或完全。" }
}[helper] ?? { label: `补助动词「${helper}」`, note: `接「${helper}」构成补助表达。` });

const describeCompound = (
  surface: string,
  dictionaryForm: string,
  verbType: string,
  morphs: TokenMorph[],
  lemmaReading = "",
  dictionaryReading = ""
): ConjugationExplanation | null => {
  if (!morphs.length || !isVerb(morphs[0].pos)) return null;
  const firstPotentialBase = potentialBaseForm(morphs[0].lemma, dictionaryForm, dictionaryReading);
  const first = simpleVerbCandidate(
    morphs[0].surface,
    morphs[0].lemma,
    dictionaryForm,
    verbType,
    lemmaReading,
    dictionaryReading,
    !morphConfirmsPotential(morphs, firstPotentialBase ?? dictionaryForm)
  );
  if (!first) return null;
  let built = morphs[0].surface;
  const nextMorph = morphs[1];
  const omitRedundantStem = first.label === "连用形" && Boolean(
    (nextMorph?.pos === "助詞" && (nextMorph.surface === "て" || nextMorph.surface === "で"))
      || (nextMorph?.pos === "動詞" && nextMorph.detail === "接尾" && (nextMorph.lemma === "れる" || nextMorph.lemma === "られる"))
  );
  const steps: ConjugationStep[] = omitRedundantStem ? [] : [{ label: first.label, from: dictionaryForm, to: built, note: first.rule }];
  let pendingTe = false;
  for (let index = 1; index < morphs.length; index += 1) {
    const morph = morphs[index];
    if (morph.pos === "助詞" && (morph.surface === "て" || morph.surface === "で")) {
      const from = steps.length ? built : dictionaryForm;
      built += morph.surface;
      steps.push({ label: "て形", from, to: built, note: teTaRule(dictionaryForm, verbType, "て形") });
      pendingTe = true;
      continue;
    }
    const helper = morph.lemma;
    const from = steps.length ? built : dictionaryForm;

    // Collapse the common polite auxiliary chains: ました, ません and でした.
    if (morph.pos === "助動詞" && morph.lemma === "ます") {
      const group = [morph];
      const next = morphs[index + 1];
      if (next?.pos === "助動詞" && (next.lemma === "ん" || next.lemma === "た")) {
        group.push(next);
        index += 1;
      }
      const suffix = group.map((item) => item.surface).join("");
      built += suffix;
      const negative = group.some((item) => item.lemma === "ん");
      const past = group.some((item) => item.lemma === "た");
      steps.push({
        label: negative ? "敬体否定" : past ? "敬体过去" : "敬体",
        from,
        to: built,
        note: negative ? "接敬体助动词「ます」的否定「ません」。" : past ? "接敬体助动词「ます」的过去形「ました」。" : "接敬体助动词「ます」。"
      });
      pendingTe = false;
      continue;
    }
    if (morph.pos === "助動詞" && morph.lemma === "です" && morphs[index + 1]?.lemma === "た") {
      built += `${morph.surface}${morphs[index + 1].surface}`;
      index += 1;
      steps.push({ label: "敬体过去", from, to: built, note: "接判断助动词「です」的过去形「でした」。" });
      pendingTe = false;
      continue;
    }

    built += morph.surface;
    if (morph.pos === "助動詞" && morph.lemma === "ない") {
      steps.push({ label: "否定形", from, to: built, note: "接否定助动词「ない」。" });
      continue;
    }
    if (morph.pos === "助動詞" && morph.lemma === "ん") {
      steps.push({ label: "否定形", from, to: built, note: "接口语否定助动词「ん」。" });
      continue;
    }
    if (morph.pos === "動詞" && morph.detail === "接尾") {
      const passive = helper === "れる" || helper === "られる";
      const ambiguous = helper === "られる" && (verbType === "ichidan" || verbType === "kuru");
      const label = ambiguous ? "可能形／受身形" : passive ? "受身形" : helper === "せる" || helper === "させる" ? "使役形" : "接尾动词";
      const note = ambiguous
        ? `一段动词接「${helper}」；这个形式可能表示“能够……”，也可能表示“被……”，需要结合整句语境判断。`
        : passive
          ? `动词未然形接「${helper}」，形成受身形。`
          : helper === "せる" || helper === "させる"
            ? `动词未然形接「${helper}」，形成使役形。`
            : `接「${helper}」形成复合词形。`;
      steps.push({ label, from, to: built, note });
      continue;
    }
    if (morph.pos === "動詞" && morph.detail === "非自立") {
      const potentialBase = potentialDictionaryCandidates(helper)[0];
      if (potentialBase && morph.surface === helper.slice(0, -1)) {
        steps.push({ label: "可能形", from, to: built, note: `${potentialBase}变为可能形「${helper}」。` });
      } else {
        const description = auxiliaryDescription(helper);
        steps.push({
          label: pendingTe ? description.label : description.label.replace(/^补助/u, "复合"),
          from,
          to: built,
          note: pendingTe ? description.note : `接「${helper}」，${description.note.replace(`「て」后接「${helper}」，`, "")}`
        });
      }
      pendingTe = false;
      continue;
    }
    if (morph.pos === "助動詞" && morph.lemma === "た") {
      steps.push({ label: "过去（た形）", from, to: built, note: "接过去助动词「た」，形成过去／完成形。" });
      continue;
    }
    if (morph.pos === "助詞" || morph.pos === "助動詞") {
      steps.push({ label: morph.surface === "ば" ? "条件形" : `助动词「${helper || morph.surface}」`, from, to: built, note: `接「${morph.surface}」构成后续词形。` });
      continue;
    }
    // Unknown material in a compound block: do not invent a rule.
    return null;
  }
  if (built !== surface || steps.length < 1) return null;
  return {
    label: "复合词形",
    rule: steps.map((step) => step.note).join(" "),
    steps
  };
};

/** Explain only forms whose forward reconstruction is exact. */
const describeConjugationSingle = ({
  surface: rawSurface,
  lemma: rawLemma,
  dictionaryForm: rawDictionaryForm,
  verbType,
  pos,
  morphs,
  reading = "",
  dictionaryReading = ""
}: ConjugationInput): ConjugationExplanation | null => {
  const surface = clean(rawSurface);
  const lemma = clean(rawLemma) || clean(rawDictionaryForm);
  const dictionaryForm = clean(rawDictionaryForm) || lemma;
  if (!surface || !lemma) return null;

  if (morphs?.length && morphs.length > 1
    && morphs.some((morph) => morph.pos === "動詞" && (morph.detail === "非自立" || morph.detail === "接尾"))) {
    return describeCompound(surface, dictionaryForm, verbType, morphs, reading, dictionaryReading);
  }
  const potentialBase = potentialBaseForm(lemma, dictionaryForm, dictionaryReading);
  const potential = potentialBase
    && !isKnownVerbPair(lemma, potentialBase, reading, dictionaryReading)
    ? potentialCandidate(surface, potentialBase, verbType, !morphConfirmsPotential(morphs, potentialBase))
    : null;
  if (potential) return publicCandidate(potential);
  if (surface === lemma) return null;

  if (pos.includes("形容") && lemma.endsWith("い")) {
    const stem = lemma.slice(0, -1);
    const adjectiveCandidates: Array<Candidate | null> = [
      match(surface, `${stem}くない`, "形容词否定形", `${lemma}去掉「い」，接「くない」。`),
      match(surface, `${stem}くなかった`, "形容词过去否定", `${lemma}去掉「い」，接「くなかった」。`),
      match(surface, `${stem}かった`, "形容词过去形", `${lemma}去掉「い」，接「かった」。`),
      match(surface, `${stem}ければ`, "形容词条件形", `${lemma}去掉「い」，接「ければ」，表示“如果……”。`),
      match(surface, `${stem}くて`, "形容词て形", `${lemma}去掉「い」，接「くて」，用于连接后项。`),
      match(surface, `${lemma}です`, "形容词敬体非过去", `${lemma}后接「です」，使表达更礼貌；形容词本身不去掉「い」。`),
      match(surface, `${stem}くありません`, "形容词敬体否定", `${lemma}去掉「い」，接「くありません」。`),
      match(surface, `${stem}くないです`, "形容词敬体否定", `${lemma}去掉「い」，接「くないです」。`),
      match(surface, `${stem}くありませんでした`, "形容词敬体过去否定", `${lemma}去掉「い」，接「くありませんでした」。`),
      match(surface, `${stem}くなかったです`, "形容词敬体过去否定", `${lemma}去掉「い」，接「くなかったです」。`),
      match(surface, `${stem}かったです`, "形容词敬体过去", `${lemma}去掉「い」，接「かったです」。`)
    ];
    return publicCandidate(adjectiveCandidates.find(Boolean) ?? null);
  }

  if (pos.includes("名词") || pos.includes("な形容")) {
    const nominalCandidates: Array<Candidate | null> = [
      match(surface, `${lemma}ではありませんでした`, "名词谓语・敬体过去否定", `${lemma}后接「ではありませんでした／じゃありませんでした」，表示过去的否定判断。`),
      match(surface, `${lemma}じゃありませんでした`, "名词谓语・敬体过去否定", `${lemma}后接「ではありませんでした／じゃありませんでした」，表示过去的否定判断。`),
      match(surface, `${lemma}ではありません`, "名词谓语・敬体否定", `${lemma}后接「ではありません／じゃありません」，表示礼貌的否定判断。`),
      match(surface, `${lemma}じゃありません`, "名词谓语・敬体否定", `${lemma}后接「ではありません／じゃありません」，表示礼貌的否定判断。`),
      match(surface, `${lemma}でした`, "名词谓语・敬体过去", `${lemma}后接「でした」，表示礼貌的过去判断。`),
      match(surface, `${lemma}です`, "名词谓语・敬体", `${lemma}后接「です」，表示礼貌的判断。`),
      match(surface, `${lemma}だった`, "名词谓语・普通体过去", `${lemma}后接「だった」，表示普通体的过去判断。`),
      match(surface, `${lemma}ではない`, "名词谓语・普通体否定", `${lemma}后接「ではない／じゃない」，表示普通体的否定判断。`),
      match(surface, `${lemma}じゃない`, "名词谓语・普通体否定", `${lemma}后接「ではない／じゃない」，表示普通体的否定判断。`),
      match(surface, `${lemma}なら`, "名词谓语・条件形", `${lemma}后接「なら」，表示“如果是……／说到……”。`),
      match(surface, `${lemma}で`, "名词谓语・中顿形", `${lemma}后接「で」，连接后面的判断或状态。`),
      match(surface, `${lemma}だ`, "名词谓语・普通体", `${lemma}后接断定助动词「だ」。`)
    ];
    return publicCandidate(nominalCandidates.find(Boolean) ?? null);
  }

  if (!isVerb(pos)) return null;
  return publicCandidate(simpleVerbCandidate(surface, lemma, dictionaryForm, verbType, reading, dictionaryReading));
};

/**
 * Explain with the stored dictionary spelling first, then retry with the
 * kana lemma for orthographic variants such as かかります→掛かる.  The
 * first pass preserves kanji-specific matches; the fallback only changes the
 * reconstruction alphabet, not the lookup result or POS.
 */
export const describeConjugation = (input: ConjugationInput): ConjugationExplanation | null => {
  const primary = describeConjugationSingle(input);
  if (primary) return primary;
  const lemma = clean(input.lemma);
  const dictionaryForm = clean(input.dictionaryForm);
  if (lemma && dictionaryForm && lemma !== dictionaryForm) {
    return describeConjugationSingle({ ...input, dictionaryForm: lemma });
  }
  return null;
};
