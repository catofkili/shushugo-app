#!/usr/bin/env node
/*
 * Build the content index used by the future unit-level kanji scheduler.
 *
 * Important boundary: this script intentionally reads the release/seed DB only.
 * Never point it at frontend/.local/live.db: that database contains personal
 * imports and study state and must not become shipped/syncable content.
 *
 * Usage (from frontend/):
 *   node scripts/build-kanji-reading-unit-index.mjs
 *   node scripts/build-kanji-reading-unit-index.mjs --db public/nihongo.db --out src/data/kanji_reading_unit_index.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = new URL(".", import.meta.url);
const frontend = fileURLToPath(new URL("..", here));
const defaultDb = resolve(frontend, "public/nihongo.db");
const defaultOut = resolve(frontend, "src/data/kanji_reading_unit_index.json");
const readingsPath = resolve(frontend, "src/data/kanji_readings.json");
const manualReviewPath = resolve(frontend, "scripts/kanji-reading-unit-manual-review.json");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dbPath = resolve(frontend, argValue("--db", defaultDb));
const outputPath = resolve(frontend, argValue("--out", defaultOut));

const canonicalDb = resolve(defaultDb);
const relativeDb = relative(frontend, dbPath);
if (dbPath !== canonicalDb || /(^|[\\/])(?:\.local|live\.db)(?:[\\/]|$)/u.test(relativeDb)) {
  throw new Error(`拒绝从个人实时库生成发布索引: ${dbPath}。只允许 ${canonicalDb}`);
}

const isKanji = (char) => /[\u3400-\u9fff々〇]/u.test(char);
const isKanjiSurface = (text) => [...String(text ?? "")].some(isKanji);
const toHiragana = (text) => String(text ?? "").replace(/[ァ-ヶ]/gu, (char) =>
  String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
);
const normalizeKana = (text) => toHiragana(text).replace(/ヵ/gu, "か").replace(/ヶ/gu, "け");
const normalizeSurface = (text) => String(text ?? "")
  .replace(/^\([^)]*\)\s*/u, "")
  .replace(/\[[^\]]*\]/gu, "")
  .replace(/[〜～]/gu, "")
  .replace(/\s+/gu, "");
const normalizeReading = (text) => normalizeKana(text).replace(/[〜～]/gu, "").replace(/\s+/gu, "");

const RENDAKU = new Map([
  ["か", "が"], ["き", "ぎ"], ["く", "ぐ"], ["け", "げ"], ["こ", "ご"],
  ["さ", "ざ"], ["し", "じ"], ["す", "ず"], ["せ", "ぜ"], ["そ", "ぞ"],
  ["た", "だ"], ["ち", "ぢ"], ["つ", "づ"], ["て", "で"], ["と", "ど"],
  ["は", "ば"], ["ひ", "び"], ["ふ", "ぶ"], ["へ", "べ"], ["ほ", "ぼ"]
]);
const HANDAKU = new Map([["は", "ぱ"], ["ひ", "ぴ"], ["ふ", "ぷ"], ["へ", "ぺ"], ["ほ", "ぽ"]]);
const RENYOU = new Map([
  ["う", "い"], ["く", "き"], ["ぐ", "ぎ"], ["す", "し"], ["つ", "ち"],
  ["ぬ", "に"], ["ぶ", "び"], ["む", "み"], ["る", "り"]
]);

const formsFor = (entry, kind) => {
  const forms = [];
  const readings = Array.isArray(entry?.[kind]) ? entry[kind] : [];
  readings.forEach((raw, index) => {
    const source = normalizeKana(raw);
    const [stem, okurigana = ""] = kind === "kun" ? source.split(".") : [source, ""];
    const base = stem;
    const add = (form, variant, extraCost = 0) => {
      if (!form) return;
      forms.push({ form, base, kind, variant, cost: index + extraCost });
    };
    const addVoiced = (form, variant, extraCost = 1) => {
      if (!form) return;
      const rendaku = RENDAKU.get(form[0]);
      if (rendaku) add(rendaku + form.slice(1), variant, extraCost);
      const handaku = HANDAKU.get(form[0]);
      if (handaku) add(handaku + form.slice(1), `${variant}-handaku`, extraCost + 1);
    };
    add(base, "base");
    // KUN readings participate in compound voicing too (入口→いりぐち,
    // 山小屋→やまごや, etc.). Keeping the voiced form as a higher-cost
    // candidate lets the deterministic aligner prefer the lexical base when
    // both are possible without discarding the real surface reading.
    addVoiced(base, "rendaku");
    if (kind === "on") {
      const rendaku = RENDAKU.get(base[0]);
      if (rendaku) add(rendaku + base.slice(1), "rendaku", 1);
      const handaku = HANDAKU.get(base[0]);
      if (handaku) add(handaku + base.slice(1), "handaku", 1);
      if (/[つちく]$/u.test(base)) add(`${base.slice(0, -1)}っ`, "sokuon", 1);
      add(`${base}っ`, "sokuon-suffix", 2);
      if (/[ちつ]$/u.test(base) && base.length > 1) add(base.slice(0, -1), "on-drop", 2);
    } else {
      for (let take = 1; take <= okurigana.length; take += 1) {
        add(stem + okurigana.slice(0, take), "okurigana", take < okurigana.length ? 3 : 2);
      }
      const renyou = RENYOU.get(okurigana[0] ?? "");
      if (renyou) add(stem + renyou, "renyou", 3);
    }
  });
  return forms.sort((left, right) => left.cost - right.cost || left.form.localeCompare(right.form, "ja"));
};

const splitRuns = (surface) => {
  const runs = [];
  let offset = 0;
  for (const char of String(surface)) {
    const kanji = isKanji(char);
    const last = runs[runs.length - 1];
    if (last && last.kanji === kanji) {
      last.text += char;
      last.length += char.length;
    } else {
      runs.push({ text: char, kanji, start: offset, length: char.length });
    }
    offset += char.length;
  }
  return runs;
};

const expandIterationMark = (surface) => {
  let previous = "";
  let expanded = "";
  let count = 0;
  for (const char of String(surface)) {
    if (char === "々" && previous && isKanji(previous)) {
      expanded += previous;
      count += 1;
    } else {
      expanded += char;
    }
    if (isKanji(char) && char !== "々") previous = char;
  }
  return { surface: expanded, count };
};

const alignWord = (surface, kana, readingTable) => {
  const target = normalizeKana(kana);
  const expanded = expandIterationMark(surface);
  const runs = splitRuns(expanded.surface);
  let steps = 0;
  const budget = 20000;
  let best = null;
  let bestSignatures = new Set();

  const candidateList = (char, previous) => {
    const lookup = char === "々" ? previous : char;
    return [
      ...formsFor(readingTable[lookup], "on"),
      ...formsFor(readingTable[lookup], "kun")
    ].sort((left, right) => left.cost - right.cost || left.kind.localeCompare(right.kind));
  };
  const walkRun = (runIndex, charIndex, position, picks, cost) => {
    if (++steps > budget || (best && cost > best.cost)) return;
    if (runIndex >= runs.length) {
      if (position === target.length) {
        if (!best || cost < best.cost) {
          best = { picks: [...picks], cost };
          bestSignatures = new Set([picks.map((pick) => `${pick.char}:${pick.base}:${pick.kind}:${pick.reading}`).join(";")]);
        } else if (cost === best.cost) {
          bestSignatures.add(picks.map((pick) => `${pick.char}:${pick.base}:${pick.kind}:${pick.reading}`).join(";"));
        }
      }
      return;
    }
    const run = runs[runIndex];
    if (!run.kanji) {
      const literal = normalizeKana(run.text);
      if (!target.startsWith(literal, position)) return;
      walkRun(runIndex + 1, 0, position + literal.length, picks, cost);
      return;
    }
    const char = [...run.text][charIndex];
    const previous = charIndex > 0 ? [...run.text][charIndex - 1] : runIndex > 0 ? [...runs[runIndex - 1].text].at(-1) : "";
    const isLast = runIndex === runs.length - 1 && charIndex === [...run.text].length - 1;
    for (const candidate of candidateList(char, previous)) {
      const form = normalizeKana(candidate.form);
      if (!target.startsWith(form, position)) continue;
      if (isLast && position + form.length !== target.length) continue;
      const charOffset = [...run.text].slice(0, charIndex).join("").length;
      const start = run.start + charOffset;
      picks.push({ char, base: candidate.base, kind: candidate.kind, variant: candidate.variant, reading: kana.slice(position, position + form.length), start, length: char.length, surfaceChar: surface.slice(start, start + char.length) });
      if (charIndex + 1 < [...run.text].length) walkRun(runIndex, charIndex + 1, position + form.length, picks, cost + candidate.cost);
      else walkRun(runIndex + 1, 0, position + form.length, picks, cost + candidate.cost);
      picks.pop();
    }
  };
  walkRun(0, 0, 0, [], 0);
  return best ? { ...best, tieCount: Math.max(bestSignatures.size - 1, 0), expandedIterationMarks: expanded.count } : null;
};

const unitKey = (unitType, char, base, surface, reading) =>
  [unitType, char, base, surface, reading].join("|");

const manualReview = JSON.parse(readFileSync(manualReviewPath, "utf8"));
const splitManualPair = (value) => {
  const separator = String(value).indexOf("|");
  if (separator < 0) return null;
  return { surface: String(value).slice(0, separator), reading: String(value).slice(separator + 1) };
};
const manualJukujikun = new Map();
for (const value of [...(manualReview.official ?? []), ...(manualReview.additional ?? [])]) {
  const pair = splitManualPair(value);
  if (!pair) continue;
  manualJukujikun.set(`${pair.surface}|${normalizeReading(pair.reading)}`, { ...pair, source: "manual-catalog" });
}
for (const value of manualReview.contextVariants ?? []) {
  const parts = String(value).split("|");
  if (parts.length !== 4) continue;
  const [variantSurface, variantReading, canonicalSurface, canonicalReading] = parts;
  const key = `${canonicalSurface}|${normalizeReading(canonicalReading)}`;
  const existing = manualJukujikun.get(key) ?? {
    surface: canonicalSurface,
    reading: canonicalReading,
    source: "manual-catalog",
    variants: []
  };
  existing.variants = [...new Set([...(existing.variants ?? []), `${variantSurface}|${normalizeReading(variantReading)}`])];
  manualJukujikun.set(key, existing);
}

const findManualMatches = (surface, reading) => {
  const matches = [];
  for (const entry of manualJukujikun.values()) {
    const surfaceNeedle = normalizeSurface(entry.surface);
    const readings = [entry.reading, ...(entry.variants ?? []).map((value) => String(value).split("|")[1])]
      .map(normalizeReading);
    if (!surfaceNeedle || !readings.length) continue;
    let surfaceStart = surface.indexOf(surfaceNeedle);
    while (surfaceStart >= 0) {
      for (const candidateReading of readings) {
        const readingStart = reading.indexOf(candidateReading);
        if (readingStart >= 0) matches.push({
          surfaceStart,
          surfaceLength: surfaceNeedle.length,
          readingStart,
          readingLength: candidateReading.length,
          surface: surfaceNeedle,
          reading: entry.reading,
          actualReading: candidateReading,
          source: entry.source
        });
      }
      surfaceStart = surface.indexOf(surfaceNeedle, surfaceStart + 1);
    }
  }
  // Prefer the longest explicit unit and reject overlapping shorter matches.
  return matches
    .sort((left, right) => right.surfaceLength - left.surfaceLength || left.surfaceStart - right.surfaceStart || left.readingStart - right.readingStart)
    .filter((match, index, list) => !list.slice(0, index).some((kept) =>
      match.surfaceStart < kept.surfaceStart + kept.surfaceLength && kept.surfaceStart < match.surfaceStart + match.surfaceLength
    ))
    .sort((left, right) => left.surfaceStart - right.surfaceStart || left.readingStart - right.readingStart);
};

const alignWithManualMatches = (surface, reading, matches, readingTable) => {
  if (!matches.length) return alignWord(surface, reading, readingTable);
  const picks = [];
  let cost = 0;
  let tieCount = 0;
  let surfaceCursor = 0;
  let readingCursor = 0;
  for (const match of matches) {
    const gapSurface = surface.slice(surfaceCursor, match.surfaceStart);
    const gapReading = reading.slice(readingCursor, match.readingStart);
    const gap = alignWord(gapSurface, gapReading, readingTable);
    if (!gap) return null;
    cost += gap.cost;
    tieCount += gap.tieCount;
    picks.push(...gap.picks.map((pick) => ({ ...pick, start: pick.start + surfaceCursor })));
    surfaceCursor = match.surfaceStart + match.surfaceLength;
    readingCursor = match.readingStart + match.readingLength;
  }
  const tail = alignWord(surface.slice(surfaceCursor), reading.slice(readingCursor), readingTable);
  if (!tail) return null;
  cost += tail.cost;
  tieCount += tail.tieCount;
  picks.push(...tail.picks.map((pick) => ({ ...pick, start: pick.start + surfaceCursor })));
  return { picks, cost, tieCount, expandedIterationMarks: 0 };
};

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
const result = db.exec("SELECT id, kanji, kana, COALESCE(importance, 0), COALESCE(jlpt_level, '') FROM words ORDER BY id ASC");
const words = result[0]?.values.map(([id, kanji, kana, importance, jlptLevel]) => ({
  id: Number(id), kanji: String(kanji ?? ""), kana: String(kana ?? ""), importance: Number(importance ?? 0), jlptLevel: String(jlptLevel ?? "")
})) ?? [];
const readingPayload = JSON.parse(readFileSync(readingsPath, "utf8"));
const readingTable = readingPayload.readings ?? {};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const units = new Map();
const occurrences = [];
const unresolved = [];
const alignmentTies = [];
const manualReviewLog = [];
let wordsWithKanji = 0;
let alignedWords = 0;
let jukujikunCandidates = 0;
let jukujikunUnits = 0;
let reviewedUnresolvedCandidates = 0;
let reviewedAlignmentTies = 0;
let expandedIterationMarks = 0;

for (const word of words) {
  const rawHasKanji = isKanjiSurface(word.kanji) && word.kanji !== word.kana;
  const rawAligned = rawHasKanji ? alignWord(word.kanji, word.kana, readingTable) : null;
  const rawNeedsReview = rawHasKanji && (!rawAligned || rawAligned.tieCount > 0);
  if (rawHasKanji && !rawAligned) reviewedUnresolvedCandidates += 1;
  if (rawHasKanji && rawAligned?.tieCount > 0) reviewedAlignmentTies += 1;
  const normalizedSurface = normalizeSurface(word.kanji);
  const normalizedReading = normalizeReading(word.kana);
  if (!isKanjiSurface(normalizedSurface) || normalizedSurface === normalizedReading) {
    if (rawNeedsReview) manualReviewLog.push({
      exampleWordId: word.id,
      surface: word.kanji,
      reading: word.kana,
      normalizedSurface,
      normalizedReading,
      reason: rawAligned ? "raw-alignment-tie" : "raw-mixed-surface-alignment",
      decision: "excluded-surface",
      manualUnitCount: 0,
      tieCount: rawAligned?.tieCount ?? 0,
      importance: word.importance,
      jlptLevel: word.jlptLevel
    });
    continue;
  }
  wordsWithKanji += 1;
  const manualMatches = findManualMatches(normalizedSurface, normalizedReading);
  const aligned = alignWithManualMatches(normalizedSurface, normalizedReading, manualMatches, readingTable);
  if (!aligned) {
    const onlyKanji = [...normalizedSurface].every((char) => isKanji(char));
    const reason = onlyKanji ? "no-character-alignment" : "mixed-surface-alignment";
    if (onlyKanji && [...normalizedSurface].length >= 2) jukujikunCandidates += 1;
    manualReviewLog.push({
      exampleWordId: word.id,
      surface: word.kanji,
      reading: word.kana,
      normalizedSurface,
      normalizedReading,
      reason,
      decision: manualMatches.length ? "jukujikun" : "reviewed-no-unit",
      manualUnitCount: manualMatches.length,
      importance: word.importance,
      jlptLevel: word.jlptLevel
    });
    continue;
  }
  alignedWords += 1;
  if (aligned.tieCount > 0) {
    manualReviewLog.push({
      exampleWordId: word.id,
      surface: word.kanji,
      reading: word.kana,
      normalizedSurface,
      normalizedReading,
      reason: "alignment-tie",
      decision: "reviewed-best-alignment",
      manualUnitCount: manualMatches.length,
      tieCount: aligned.tieCount,
      importance: word.importance,
      jlptLevel: word.jlptLevel
    });
  }
  expandedIterationMarks += aligned.expandedIterationMarks;
  for (const match of manualMatches) {
    const key = unitKey("jukujikun", "", "", match.surface, match.reading);
    if (!units.has(key)) units.set(key, {
      unitKey: key, unitType: "jukujikun", char: "", base: "", surface: match.surface, reading: match.reading, kinds: []
    });
    jukujikunUnits += 1;
    occurrences.push({
      unitKey: key,
      exampleWordId: word.id,
      targetSegment: { start: match.surfaceStart, length: match.surfaceLength, text: match.surface },
      reading: match.actualReading,
      variant: match.actualReading === normalizeReading(match.reading) ? "manual-jukujikun" : "manual-jukujikun-variant"
    });
  }
  const isCovered = (pick) => manualMatches.some((match) =>
    pick.start < match.surfaceStart + match.surfaceLength && match.surfaceStart < pick.start + pick.length
  );
  for (const pick of aligned.picks) {
    if (isCovered(pick)) continue;
    const key = unitKey("char", pick.char, pick.base, "", "");
    if (!units.has(key)) units.set(key, {
      unitKey: key, unitType: "char", char: pick.char, base: pick.base, surface: "", reading: "", kinds: []
    });
    const unit = units.get(key);
    if (!unit.kinds.includes(pick.kind)) unit.kinds.push(pick.kind);
    occurrences.push({ unitKey: key, exampleWordId: word.id, targetSegment: { start: pick.start, length: pick.length, text: pick.surfaceChar }, reading: pick.reading, variant: pick.variant });
  }
  if ((manualMatches.length || rawNeedsReview) && !manualReviewLog.some((item) => item.exampleWordId === word.id)) {
    manualReviewLog.push({
      exampleWordId: word.id,
      surface: word.kanji,
      reading: word.kana,
      normalizedSurface,
      normalizedReading,
      reason: manualMatches.length ? "manual-jukujikun-override" : "character-aligned",
      decision: manualMatches.length ? "jukujikun" : "character-alignment",
      manualUnitCount: manualMatches.length,
      importance: word.importance,
      jlptLevel: word.jlptLevel
    });
  }
}

const sortedUnits = [...units.values()].map((unit) => ({ ...unit, kinds: [...unit.kinds].sort() })).sort((left, right) => left.unitKey.localeCompare(right.unitKey, "ja"));
const sortedOccurrences = occurrences.sort((left, right) => left.exampleWordId - right.exampleWordId || left.targetSegment.start - right.targetSegment.start || left.unitKey.localeCompare(right.unitKey, "ja"));
const stratumOf = (item) => {
  const surfaceChars = [...(item.normalizedSurface ?? normalizeSurface(item.surface))];
  const surfaceClass = surfaceChars.every(isKanji) ? "kanji-only" : "mixed";
  const lengthClass = surfaceChars.length === 1 ? "1" : surfaceChars.length === 2 ? "2" : "3-plus";
  const markClass = surfaceChars.includes("々") ? "iteration" : "plain";
  return `${surfaceClass}|${lengthClass}|${markClass}`;
};
const reviewByStratum = new Map();
for (const item of manualReviewLog.filter((candidate) =>
  candidate.reason === "no-character-alignment" || candidate.reason === "mixed-surface-alignment" || candidate.reason === "alignment-tie"
)) {
  const stratum = stratumOf(item);
  const list = reviewByStratum.get(stratum) ?? [];
  list.push(item);
  reviewByStratum.set(stratum, list);
}
for (const list of reviewByStratum.values()) list.sort((left, right) => right.importance - left.importance || left.exampleWordId - right.exampleWordId);
const strata = [...reviewByStratum.keys()].sort();
const manualReviewSample = [];
const targetReviewCount = Math.min(200, manualReviewLog.length);
let cursor = 0;
while (manualReviewSample.length < targetReviewCount && strata.length) {
  const stratum = strata[cursor % strata.length];
  const list = reviewByStratum.get(stratum);
  const item = list?.shift();
  if (item) {
    manualReviewSample.push({
      exampleWordId: item.exampleWordId,
      surface: item.surface,
      reading: item.reading,
      reason: item.reason,
      stratum,
      suggestedUnitType: item.decision === "jukujikun" || stratum.startsWith("kanji-only|") ? "jukujikun" : "char"
    });
  }
  if (strata.every((key) => !(reviewByStratum.get(key)?.length))) break;
  cursor += 1;
}
const payload = {
  version: "2026-08-22-kanji-reading-units-v1",
  generatedBy: "frontend/scripts/build-kanji-reading-unit-index.mjs",
  source: {
    database: "public/nihongo.db",
    liveDatabase: false,
    wordCount: words.length,
    sha256: sha256(dbPath),
    readingsSha256: sha256(readingsPath)
  },
  units: sortedUnits,
  occurrences: sortedOccurrences,
  unresolved: unresolved.sort((left, right) => left.exampleWordId - right.exampleWordId),
  alignmentTies: alignmentTies.sort((left, right) => left.exampleWordId - right.exampleWordId),
  manualReview: manualReviewSample,
  manualReviewLog: manualReviewLog.sort((left, right) => left.exampleWordId - right.exampleWordId),
  manualReviewPolicy: manualReview.policy,
  stats: {
    wordCount: words.length,
    wordsWithKanji,
    alignedWords,
    jukujikunCandidates,
    jukujikunUnits,
    jukujikunUnitCount: sortedUnits.filter((unit) => unit.unitType === "jukujikun").length,
    reviewedUnresolvedCandidates,
    reviewedAlignmentTies,
    unresolvedWords: unresolved.length,
    tieCases: alignmentTies.reduce((sum, item) => sum + item.tieCount, 0),
    ambiguousWords: alignmentTies.length,
    manualReviewCount: manualReviewLog.length,
    manualReviewSampleCount: manualReviewSample.length,
    expandedIterationMarks
  }
};
writeFileSync(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

/**
 * 运行时索引：审计字段全部丢掉，形状换成元组。
 *
 * 完整索引 2.8 MB,其中 occurrences 占 2.2 MB —— 全是重复的字段名。
 * 运行时真正要的只有三样:单位本身、打分用的例词 id 列表、出题用的前几个例词切段。
 * 压到 ~390 KB,而且走动态 import 单独成 chunk,主包一个字节都不碰
 * (grammar.ts 1.5 MB 进主包是前车之鉴)。
 */
const RUNTIME_EXAMPLE_CAP = 6;
const LEVEL_ORDER = ["N5", "N4", "N3", "N2", "N1"];
const wordById = new Map(words.map((word) => [word.id, word]));
const occurrencesByUnit = new Map();
for (const occurrence of sortedOccurrences) {
  const list = occurrencesByUnit.get(occurrence.unitKey) ?? [];
  list.push(occurrence);
  occurrencesByUnit.set(occurrence.unitKey, list);
}
const variantNames = [...new Set(sortedOccurrences.map((occurrence) => occurrence.variant))].sort();
const variantIndex = new Map(variantNames.map((name, index) => [name, index]));
/** 单位的级别 = 它第一次成为必需的那一级(例词里最低的 JLPT);无级按 N1 之后算。 */
const unitLevel = (unitKey) => {
  const ranks = (occurrencesByUnit.get(unitKey) ?? [])
    .map((occurrence) => LEVEL_ORDER.indexOf(wordById.get(occurrence.exampleWordId)?.jlptLevel ?? ""))
    .filter((rank) => rank >= 0);
  return ranks.length ? Math.min(...ranks) : LEVEL_ORDER.length;
};
const runtime = {
  version: payload.version,
  generatedBy: payload.generatedBy,
  levels: LEVEL_ORDER,
  variants: variantNames,
  exampleCap: RUNTIME_EXAMPLE_CAP,
  // [unitType, char, base, surface, reading, kindsBits, levelRank]
  // kindsBits: 1=on, 2=kun, 3=两者都是(23 个音训双属读音)
  units: sortedUnits.map((unit) => [
    unit.unitType === "char" ? 0 : 1,
    unit.char,
    unit.base,
    unit.surface,
    unit.reading,
    (unit.kinds.includes("on") ? 1 : 0) | (unit.kinds.includes("kun") ? 2 : 0),
    unitLevel(unit.unitKey)
  ]),
  // 打分要的全部例词 id(纯整数,便宜),与 units 同序
  wordIds: sortedUnits.map((unit) =>
    (occurrencesByUnit.get(unit.unitKey) ?? []).map((occurrence) => occurrence.exampleWordId)
  ),
  // 出题要的前几个例词:[wordId, start, length, reading, variantIndex]
  // segment.text 不存,由词表面按 start/length 现切
  examples: sortedUnits.map((unit) =>
    (occurrencesByUnit.get(unit.unitKey) ?? []).slice(0, RUNTIME_EXAMPLE_CAP).map((occurrence) => [
      occurrence.exampleWordId,
      occurrence.targetSegment.start,
      occurrence.targetSegment.length,
      occurrence.reading,
      variantIndex.get(occurrence.variant) ?? 0
    ])
  )
};
const runtimePath = outputPath.replace(/index\.json$/, "runtime.json");
writeFileSync(runtimePath, `${JSON.stringify(runtime)}\n`, "utf8");

const levelHistogram = {};
for (const unit of runtime.units) {
  const key = LEVEL_ORDER[unit[6]] ?? "无级";
  levelHistogram[key] = (levelHistogram[key] ?? 0) + 1;
}
console.log(JSON.stringify({
  output: outputPath,
  runtimeOutput: runtimePath,
  runtimeBytes: Buffer.byteLength(JSON.stringify(runtime)),
  levelHistogram,
  ...payload.stats,
  units: sortedUnits.length,
  occurrences: sortedOccurrences.length
}, null, 2));
