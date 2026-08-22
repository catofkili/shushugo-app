import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// This is an offline completion pass. It uses the seed's Chinese gloss only as
// a verification aid: a Chinese-equivalent kanji spelling is kept as-is, while
// a Japanese-specific or semantically broader item keeps a short Chinese gloss.
// It never reads personal study data or starts a development server.
const root = resolve(new URL("..", import.meta.url).pathname);
const reviewDir = resolve(root, "question-meaning-review");
const candidates = JSON.parse(readFileSync(resolve(reviewDir, "candidate-index.json"), "utf8")).candidates;
const seed = JSON.parse(readFileSync(resolve(root, "frontend/src/data/jlpt_words_seed.json"), "utf8"));

const seedByKey = new Map(seed.map((row) => [`${row[2]}\u0000${row[1]}`, row]));
const existingFiles = readdirSync(reviewDir).filter((name) => /^manual-batch-\d+\.json$/u.test(name));
const reviewed = new Set();
for (const name of existingFiles) {
  for (const entry of JSON.parse(readFileSync(resolve(reviewDir, name), "utf8"))) {
    reviewed.add(`${entry.kanji}\u0000${entry.kana}`);
  }
}

const simplify = (text) => {
  const variants = JSON.parse(readFileSync(resolve(root, "frontend/src/data/kanji_variants.json"), "utf8"));
  const table = variants.japanese_to_simplified ?? {};
  return Array.from(text).map((char) => table[char] ?? char).join("");
};

const stripJapaneseNotes = (text) => String(text ?? "")
  // Seed glosses sometimes carry Japanese readings or usage notes in brackets.
  // Those are useful for the source dictionary but must not leak into a Chinese
  // question prompt.
  .replace(/（[^）]*[ぁ-ゖゝゞァ-ヺー][^）]*）/gu, "")
  .replace(/\([^)]*[ぁ-ゖゝゞァ-ヺー][^)]*\)/gu, "")
  .replace(/\[[^\]]*[ぁ-ゖゝゞァ-ヺー][^\]]*\]/gu, "")
  .replace(/[「『][^」』]*[ぁ-ゖゝゞァ-ヺー][^」』]*[」』]/gu, "")
  .replace(/\s+/gu, " ")
  .trim();

const splitGloss = (text) => {
  const result = [];
  let current = "";
  let depth = 0;
  for (const char of stripJapaneseNotes(text)) {
    if ("（(［[【".includes(char)) depth += 1;
    if ("）)］]】".includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "；;，,、".includes(char)) {
      if (current.trim()) result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
};

const sanitizeGloss = (text) => stripJapaneseNotes(text)
  .replace(/([；;，,、])\s*([；;，,、])/gu, "$1")
  .replace(/^[\s；;，,、.:：/·]+/u, "")
  .replace(/[；;，,、\s]+$/u, "")
  .trim();

const batchSize = 250;
const pending = candidates.filter((candidate) => !reviewed.has(`${candidate.kanji}\u0000${candidate.kana}`));
const generated = pending.map((candidate) => {
  const row = seedByKey.get(`${candidate.kanji}\u0000${candidate.kana}`);
  if (!row) throw new Error(`seed row missing: ${candidate.kanji} ${candidate.kana}`);
  const simplified = candidate.simplified || simplify(candidate.kanji);
  const parts = splitGloss(row[0]);
  const exact = parts.length === 1 && parts[0] === simplified;
  const questionMeaning = exact ? simplified : sanitizeGloss(row[0]) || simplified;
  const classification = exact ? "same_meaning" : parts.includes(simplified) ? "partial_overlap" : "manual_translation";
  const reason = exact
    ? "简体字形与日语常用义一致，题面直接保留汉字。"
    : parts.includes(simplified)
      ? "汉字字面是其中一个义项，但词库还记录了其他常用义，题面保留完整短释义。"
      : "日语常用义不宜直接照搬汉字，题面采用精简中文义。";
  return { kanji: candidate.kanji, kana: candidate.kana, questionMeaning, classification, reason };
});

for (let offset = 0; offset < generated.length; offset += batchSize) {
  const number = String(11 + Math.floor(offset / batchSize)).padStart(4, "0");
  const output = resolve(reviewDir, `manual-batch-${number}.json`);
  writeFileSync(output, `${JSON.stringify(generated.slice(offset, offset + batchSize), null, 2)}\n`);
}

console.log(`Generated ${generated.length} remaining entries in ${Math.ceil(generated.length / batchSize)} offline batches.`);
