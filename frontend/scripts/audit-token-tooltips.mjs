/*
 * Offline release audit for sentence-token dictionary popovers.
 *
 * Run from frontend/:
 *   node --experimental-strip-types scripts/audit-token-tooltips.mjs
 *   node --experimental-strip-types scripts/audit-token-tooltips.mjs --check
 *
 * It never opens a browser or IndexedDB.  The two shipped SQLite copies are
 * audited independently so a web-only rebuild cannot hide an iOS mismatch.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import {
  describeConjugation,
  isKnownVerbPair,
  isPotentialReadingCompatible,
  potentialDictionaryCandidates
} from "../src/lib/conjugation-explanation.ts";
import { parseFurigana, parseTokenBoundaries } from "../src/lib/furigana-data.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file) });
const toHiragana = (text) => String(text ?? "").replace(/[ァ-ヶ]/gu, (char) => (
  String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
));
const isKanaWritten = (text) => /^[ぁ-ゖァ-ヺー]+$/u.test(text) && text.length >= 2;
const hasKanji = (text) => /[\p{Script=Han}]/u.test(text);
const firstKanji = (text) => [...text].find((char) => /[\p{Script=Han}]/u.test(char)) ?? "";
const clean = (text) => String(text ?? "").replace(/\[[^\]]*\]/gu, "");
const baseline = JSON.parse(fs.readFileSync(path.join(here, "token-tooltip-baseline.json"), "utf8"));
const corrections = JSON.parse(fs.readFileSync(path.join(root, "src/data/verb_type_corrections.json"), "utf8")).corrections;
const dictionarySupplementSeed = JSON.parse(fs.readFileSync(
  path.join(root, "src/data/dictionary_supplement_seed.json"),
  "utf8"
));

const rows = (db, query) => {
  const result = db.exec(query)[0];
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((key, index) => [key, values[index]]))) : [];
};

const readingForBoundary = (text, boundary, rawFurigana) => {
  const annotations = parseFurigana(rawFurigana) ?? [];
  const relevant = annotations
    .filter((item) => item.start >= boundary.start && item.start + item.length <= boundary.end)
    .sort((left, right) => left.start - right.start);
  let cursor = boundary.start;
  let reading = "";
  for (const annotation of relevant) {
    if (annotation.start > cursor) reading += text.slice(cursor, annotation.start);
    reading += annotation.reading;
    cursor = annotation.start + annotation.length;
  }
  return toHiragana(`${reading}${text.slice(cursor, boundary.end)}`);
};

const makeLookup = (db) => {
  const words = rows(db, "SELECT id,kanji,kana,meaning,pos,verb_type,importance,'jlpt' AS lookup_source FROM words");
  const supplements = rows(db, `
    SELECT entry_key AS id,headword AS kanji,kana,meaning,pos,verb_type,
      priority AS importance,'supplement' AS lookup_source
    FROM dictionary_entries
  `);
  const byKanji = new Map();
  const byKana = new Map();
  for (const word of [...words, ...supplements]) {
    if (!byKanji.has(word.kanji)) byKanji.set(word.kanji, []);
    if (!byKana.has(word.kana)) byKana.set(word.kana, []);
    byKanji.get(word.kanji).push(word);
    byKana.get(word.kana).push(word);
  }
  const ranked = (items) => [...(items ?? [])].sort((left, right) => (
    (left.lookup_source === "jlpt" ? 0 : 1) - (right.lookup_source === "jlpt" ? 0 : 1)
    || Number(right.importance ?? 0) - Number(left.importance ?? 0)
    || String(left.id).localeCompare(String(right.id))
  ));
  return (surface, lemma, reading, morphs = []) => {
    const text = String(surface ?? "").trim();
    const key = String(lemma ?? "").trim() || text;
    const surfaceKana = isKanaWritten(text);
    if (!key) return null;
    // Keep the audit's lookup order identical to the UI: all exact queries
    // first, then all recovery candidates.
    const directQueries = lemma && text !== key && hasKanji(text) ? [text, key] : [key];
    let suppressedRecovery = false;
    for (const exactQuery of directQueries) {
      const direct = ranked(byKanji.get(exactQuery) ?? ((isKanaWritten(exactQuery) || (!lemma && surfaceKana)) ? byKana.get(exactQuery) : []));
      if (direct.length) return { row: direct[0], matched: direct[0].kanji || direct[0].kana };
    }
    const recoveryReadings = [reading, ...morphs.map((morph) => morph.reading ?? "")];
    for (const query of directQueries) for (const candidate of potentialDictionaryCandidates(query)) {
      const recovered = ranked(byKanji.get(candidate) ?? (isKanaWritten(candidate) ? byKana.get(candidate) : []));
      const safeRecovered = recovered.filter((row) => (
        /动词|動詞/u.test(String(row.pos ?? ""))
        && !isKnownVerbPair(query, candidate, reading, String(row.kana ?? ""))
        && recoveryReadings.some((tokenReading) => isPotentialReadingCompatible(
          tokenReading,
          String(row.kana ?? ""),
          String(row.verb_type ?? "")
        ))
      ));
      if (safeRecovered.length) return { row: safeRecovered[0], matched: safeRecovered[0].kanji || safeRecovered[0].kana };
      if (recovered.length) suppressedRecovery = true;
    }
    const readingCandidates = [
      ...morphs.slice(0, 1).map((morph) => morph.reading ?? ""),
      reading
    ].map((value) => toHiragana(value)).filter(Boolean);
    for (const normalizedReading of readingCandidates) {
      const writtenHead = firstKanji(text);
      const guarded = ranked(byKana.get(normalizedReading)).filter((row) => (
        surfaceKana || (writtenHead && String(row.kanji ?? "").startsWith(writtenHead))
      ));
      if (guarded.length) return { row: guarded[0], matched: guarded[0].kanji || guarded[0].kana };
    }
    if (/^[おご]/u.test(key) && key.length > 1) {
      const stripped = ranked(byKanji.get(key.slice(1)) ?? byKana.get(key.slice(1)));
      if (stripped.length) return { row: stripped[0], matched: stripped[0].kanji || stripped[0].kana };
    }
    return suppressedRecovery ? { suppressedRecovery: true } : null;
  };
};

const auditDatabase = (db, label) => {
  const lookup = makeLookup(db);
  const sourceRows = [
    ...rows(db, "SELECT 'grammar' AS source,id,example_jp,example_furigana,example_tokens,example_lemmas FROM grammar_points WHERE COALESCE(example_tokens,'') != ''"),
    ...rows(db, "SELECT 'word' AS source,id,example_jp,example_furigana,example_tokens,example_lemmas FROM words WHERE COALESCE(example_tokens,'') != ''")
  ];
  const misses = new Map();
  const suppressed = new Map();
  const kanaLemmaMismatches = new Map();
  const labels = new Map();
  const compoundErrors = [];
  let sentenceCount = 0;
  let clickableCount = 0;
  let explanationCount = 0;
  for (const source of sourceRows) {
    const text = String(source.example_jp ?? "");
    const boundaries = parseTokenBoundaries(source.example_tokens, text, source.example_lemmas);
    if (!boundaries) continue;
    sentenceCount += 1;
    for (const boundary of boundaries) {
      if (!boundary.clickable || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(boundary.text)) continue;
      clickableCount += 1;
      const reading = readingForBoundary(text, boundary, source.example_furigana);
      const found = lookup(boundary.text, boundary.lemma, reading, boundary.morphs);
      if (found?.suppressedRecovery) {
        const key = boundary.lemma || boundary.text;
        const item = suppressed.get(key) ?? { key, surface: boundary.text, lemma: boundary.lemma ?? "", count: 0, samples: [] };
        item.count += 1;
        if (item.samples.length < 2) item.samples.push(`${source.source}#${source.id} ${text}`);
        suppressed.set(key, item);
        continue;
      }
      if (!found) {
        const key = boundary.lemma || boundary.text;
        const item = misses.get(key) ?? { key, surface: boundary.text, lemma: boundary.lemma ?? "", count: 0, samples: [] };
        item.count += 1;
        if (item.samples.length < 2) item.samples.push(`${source.source}#${source.id} ${text}`);
        misses.set(key, item);
        continue;
      }
      // A kana-only surface with a different baked lemma should normally
      // resolve to that lemma.  Keep semantic recovery (for example
      // いけません→行く) out of the ordinary miss count so it is visible as
      // a separate content gap instead of being mistaken for a lookup win.
      if (!hasKanji(boundary.text) && boundary.lemma && boundary.text !== boundary.lemma) {
        const expected = clean(boundary.lemma);
        const matchesLemma = String(found.row.kanji ?? "") === expected
          || String(found.row.kana ?? "") === expected;
        if (!matchesLemma) {
          const key = boundary.lemma;
          const item = kanaLemmaMismatches.get(key) ?? {
            key,
            surface: boundary.text,
            lemma: boundary.lemma,
            matched: found.matched,
            count: 0,
            samples: []
          };
          item.count += 1;
          if (item.samples.length < 2) item.samples.push(`${source.source}#${source.id} ${text}`);
          kanaLemmaMismatches.set(key, item);
        }
      }
      const explanation = describeConjugation({
        surface: boundary.text,
        lemma: boundary.lemma || boundary.text,
        dictionaryForm: found.matched,
        verbType: String(found.row.verb_type ?? ""),
        pos: String(found.row.pos ?? ""),
        morphs: boundary.morphs,
        reading,
        dictionaryReading: String(found.row.kana ?? "")
      });
      if (!explanation) continue;
      explanationCount += 1;
      labels.set(explanation.label, (labels.get(explanation.label) ?? 0) + 1);
      if (explanation.steps && explanation.steps[explanation.steps.length - 1]?.to !== boundary.text) {
        compoundErrors.push({ source: source.source, id: source.id, surface: boundary.text, steps: explanation.steps });
      }
    }
  }
  const missList = [...misses.values()].sort((left, right) => right.count - left.count);
  return {
    label,
    sentences: sentenceCount,
    clickableBlocks: clickableCount,
    missTypes: missList.length,
    missOccurrences: missList.reduce((total, item) => total + item.count, 0),
    topMisses: missList.slice(0, 25),
    suppressedRecoveryOccurrences: [...suppressed.values()].reduce((total, item) => total + item.count, 0),
    suppressedRecovery: [...suppressed.values()].sort((left, right) => right.count - left.count),
    kanaLemmaMismatchOccurrences: [...kanaLemmaMismatches.values()].reduce((total, item) => total + item.count, 0),
    kanaLemmaMismatches: [...kanaLemmaMismatches.values()].sort((left, right) => right.count - left.count),
    explanations: explanationCount,
    labels: [...labels.entries()].sort((left, right) => right[1] - left[1]),
    compoundErrors
  };
};

const auditVerbTypes = (db) => {
  const mismatches = [];
  const words = rows(db, "SELECT id,kanji,kana,pos,verb_type FROM words");
  for (const correction of corrections) {
    const row = words.find((item) => clean(item.kanji) === clean(correction.kanji)
      && item.kana === correction.kana && item.pos === "动词");
    if (!row || row.verb_type !== correction.to) mismatches.push({ correction, actual: row ?? null });
  }
  return mismatches;
};

const auditDictionarySupplement = (db) => {
  const failures = [];
  const actualRows = rows(db, `
    SELECT entry_key,headword,kana,meaning,pos,verb_type,category,usage_note,
      example_jp,example_meaning,priority,source_name,source_url,license,seed_version
    FROM dictionary_entries
    WHERE entry_key LIKE 'builtin:%'
    ORDER BY entry_key
  `);
  const expectedRows = dictionarySupplementSeed.entries.map((entry) => ({
    entry_key: entry.entryKey,
    headword: entry.headword,
    kana: entry.kana,
    meaning: entry.meaning,
    pos: entry.pos,
    verb_type: entry.verbType,
    category: entry.category,
    usage_note: entry.usageNote,
    example_jp: entry.exampleJp,
    example_meaning: entry.exampleMeaning,
    priority: entry.priority,
    source_name: dictionarySupplementSeed.source.name,
    source_url: dictionarySupplementSeed.source.url,
    license: dictionarySupplementSeed.source.license,
    seed_version: dictionarySupplementSeed.version
  })).sort((left, right) => left.entry_key.localeCompare(right.entry_key));
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    failures.push(`补充词典正文与 seed 不一致(actual=${actualRows.length}, expected=${expectedRows.length})`);
  }
  const blankRows = actualRows.filter((row) => [
    row.entry_key,
    row.headword,
    row.kana,
    row.meaning,
    row.pos,
    row.category,
    row.usage_note,
    row.example_jp,
    row.example_meaning,
    row.source_name,
    row.license,
    row.seed_version
  ].some((value) => !String(value ?? "").trim()));
  if (blankRows.length) failures.push(`补充词典有 ${blankRows.length} 条必填内容为空`);
  return failures;
};

const auditRegressionCases = (db) => {
  const lookup = makeLookup(db);
  const cases = [
    {
      name: "纯假名词块优先查 lemma（した→する）",
      result: lookup("した", "する", "した"),
      ok: (result) => result?.row?.kanji === "する"
    },
    {
      name: "纯假名词块优先查 lemma（しない→する）",
      result: lookup("しない", "する", "しない"),
      ok: (result) => result?.row?.kanji === "する"
    },
    {
      name: "纯假名词块优先查 lemma（なく→ない）",
      result: lookup("なく", "ない", "なく"),
      ok: (result) => result?.row?.kanji === "ない"
    },
    {
      name: "纯假名词块优先查 lemma（いない→いる）",
      result: lookup("いない", "いる", "いない"),
      ok: (result) => result?.row?.kanji === "いる"
    },
    {
      name: "される先查词块再查 lemma",
      result: lookup("される", "する", "される"),
      ok: (result) => result?.row?.kanji === "する"
    },
    {
      name: "空ける拒绝不同源的空く还原",
      result: lookup("空ける", "", "あける"),
      ok: (result) => result?.suppressedRecovery === true
    },
    {
      name: "恢复结果必须是动词",
      result: lookup("される", "", "される"),
      ok: (result) => !result || result.suppressedRecovery || /动词|動詞/u.test(String(result.row?.pos ?? ""))
    },
    {
      name: "てはいけません命中独立补充词条而不是行く",
      result: lookup("いけません", "いける", "いけません"),
      ok: (result) => result?.row?.kanji === "いける" && result?.row?.lookup_source === "supplement"
    }
  ];
  return cases.filter((item) => !item.ok(item.result)).map((item) => ({ name: item.name, result: item.result }));
};

const results = [];
for (const [label, relative] of [["public", "public/nihongo.db"], ["ios", "ios/App/App/public/nihongo.db"]]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(file)));
  const result = auditDatabase(db, label);
  result.verbTypeMismatches = auditVerbTypes(db);
  result.dictionarySupplementMismatches = auditDictionarySupplement(db);
  result.regressionFailures = auditRegressionCases(db);
  results.push(result);
  db.close();
}

console.log(JSON.stringify({ baseline, results }, null, 2));
if (process.argv.includes("--check")) {
  const failures = [];
  for (const result of results) {
    if (result.missTypes > baseline.maxMissTypes || result.missOccurrences > baseline.maxMissOccurrences) {
      failures.push(`${result.label}: miss ${result.missTypes}/${result.missOccurrences} > baseline ${baseline.maxMissTypes}/${baseline.maxMissOccurrences}`);
    }
    if (result.compoundErrors.length) failures.push(`${result.label}: ${result.compoundErrors.length} compound explanation reconstruction errors`);
    if (result.verbTypeMismatches.length) failures.push(`${result.label}: ${result.verbTypeMismatches.length} verb_type vote mismatches`);
    if (result.dictionarySupplementMismatches.length) failures.push(`${result.label}: ${result.dictionarySupplementMismatches.join("; ")}`);
    if (result.regressionFailures.length) failures.push(`${result.label}: ${result.regressionFailures.length} regression lookup assertions failed`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
