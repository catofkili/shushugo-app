import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const seedPath = resolve(root, "frontend/src/data/jlpt_words_seed.json");
const variantsPath = resolve(root, "frontend/src/data/kanji_variants.json");
const outputPath = resolve(root, "question-meaning-review/candidate-index.json");
const reviewDir = resolve(root, "question-meaning-review");

const rows = JSON.parse(readFileSync(seedPath, "utf8"));
const variantPayload = JSON.parse(readFileSync(variantsPath, "utf8"));
const variants = variantPayload.japanese_to_simplified ?? {};
const manualBatch = readdirSync(reviewDir)
  .filter((name) => /^manual-batch-\d+\.json$/u.test(name))
  .sort()
  .flatMap((name) => JSON.parse(readFileSync(resolve(reviewDir, name), "utf8")));
const reviewed = new Map(manualBatch.map((entry) => [`${entry.kanji}\u0000${entry.kana}`, entry]));
const isKanji = (char) => /[\u3400-\u9fff]/u.test(char);
const isPureKanji = (text) => Array.from(text).length >= 1 && Array.from(text).every(isKanji);
const simplified = (text) => Array.from(text).map((char) => variants[char] ?? char).join("");

const candidates = rows
  .filter((row) => isPureKanji(String(row[2] ?? "")))
  .map((row) => {
    const kanji = String(row[2] ?? "");
    const kana = String(row[1] ?? "");
    const manual = reviewed.get(`${kanji}\u0000${kana}`);
    return {
    kanji,
    kana,
    pos: String(row[3] ?? ""),
    jlpt: String(row[8] ?? ""),
    simplified: simplified(kanji),
    status: manual ? "reviewed" : "unreviewed",
    ...(manual ? { classification: manual.classification, questionMeaning: manual.questionMeaning } : {})
  }; })
  .sort((a, b) => a.kanji.localeCompare(b.kanji, "ja") || a.kana.localeCompare(b.kana, "ja"));

writeFileSync(outputPath, `${JSON.stringify({
  source: "frontend/src/data/jlpt_words_seed.json",
  meaningIntentionallyOmitted: true,
  total: candidates.length,
  candidates
}, null, 2)}\n`);

console.log(`Wrote ${candidates.length} pure-kanji candidates to ${outputPath}`);
