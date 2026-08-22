import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const batch = readdirSync(resolve(root, "question-meaning-review"))
  .filter((name) => /^manual-batch-\d+\.json$/u.test(name))
  .sort()
  .flatMap((name) => readJson(`question-meaning-review/${name}`));
const runtime = readJson("frontend/src/data/question_meaning_overrides.json");
const seed = readJson("frontend/src/data/jlpt_words_seed.json");
const live = new Set(seed.map((row) => `${row[2]}\u0000${row[1]}`));
const errors = [];
const keyOf = (entry) => `${entry.kanji}\u0000${entry.kana}`;
const kanaPattern = /[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]/u;

const checkEntries = (entries, label) => {
  const seen = new Set();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (seen.has(key)) errors.push(`${label}: duplicate ${key}`);
    seen.add(key);
    if (!live.has(key)) errors.push(`${label}: not in seed ${key}`);
    if (!entry.questionMeaning?.trim()) errors.push(`${label}: empty question meaning ${key}`);
    if (kanaPattern.test(entry.questionMeaning)) errors.push(`${label}: kana leaked ${key}`);
  }
  return seen;
};

const batchKeys = checkEntries(batch, "manual batch");
const runtimeKeys = checkEntries(runtime, "runtime overrides");
if (batchKeys.size !== runtimeKeys.size) errors.push(`batch/runtime count mismatch: ${batchKeys.size}/${runtimeKeys.size}`);
for (const entry of batch) {
  const runtimeEntry = runtime.find((candidate) => keyOf(candidate) === keyOf(entry));
  if (!runtimeEntry) errors.push(`runtime missing ${keyOf(entry)}`);
  else if (runtimeEntry.questionMeaning !== entry.questionMeaning) errors.push(`runtime text mismatch ${keyOf(entry)}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const counts = Object.groupBy(batch, (entry) => entry.classification);
  console.log(`Validated ${batch.length} manual entries; classifications: ${Object.entries(counts).map(([key, values]) => `${key}=${values.length}`).join(", ")}`);
}
