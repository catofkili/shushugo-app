import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const reviewDir = resolve(root, "question-meaning-review");
const outputPath = resolve(root, "frontend/src/data/question_meaning_overrides.json");
const batches = readdirSync(reviewDir)
  .filter((name) => /^manual-batch-\d+\.json$/u.test(name))
  .sort()
  .flatMap((name) => JSON.parse(readFileSync(resolve(reviewDir, name), "utf8")));

const seen = new Set();
const output = [];
for (const entry of batches) {
  const key = `${entry.kanji}\u0000${entry.kana}`;
  if (seen.has(key)) throw new Error(`duplicate manual question meaning: ${key}`);
  seen.add(key);
  output.push({ kanji: entry.kanji, kana: entry.kana, questionMeaning: entry.questionMeaning });
}

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.length} question-meaning overrides to ${outputPath}`);
