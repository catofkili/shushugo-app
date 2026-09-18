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
const levelOverrides = readJson("frontend/src/data/jlpt_level_overrides.json").rows ?? [];
const live = new Set([
  ...seed.map((row) => `${row[2]}\u0000${row[1]}`),
  ...levelOverrides.map((row) => `${row.kanji}\u0000${row.kana}`)
]);
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

// 自他动词题面的约定（docs/DISTINCTION_QUIZ_PLAN_ROUND2.md §2.4）：括号的位置就是语法角色。
// 他动词：后括号写宾语，或 把/使/让/弄；自动词：前括号写主语，或 变/了/着/自己。
// 「开始 / 开始做」这种靠措辞暗示的写法用户读不出来，所以按 verb_pair_hints 的 368 个词强制。
const pairHints = readJson("frontend/src/data/verb_pair_hints.json");
const transitiveOk = /（[^）]+）|[把使让弄]/u;
const intransitiveOk = /^（[^）]+）|[变了着]|自己|自然/u;
for (const entry of batch) {
  // verb_pair_hints 的键是卡面词形：有汉字的用汉字（育てる），纯假名的用假名（こぼす）。
  const role = (pairHints[entry.kanji] ?? pairHints[entry.kana])?.[0];
  if (!role) continue;
  const text = entry.questionMeaning;
  const bad = role === "他动词"
    ? !transitiveOk.test(text)
    : (!intransitiveOk.test(text) || /^[把使让]/u.test(text));
  if (bad) errors.push(`pair marker ${entry.kanji}|${entry.kana} (${role}): 「${text}」`);
}

// 辨析题面不许为了「分得开」把原文的义项砍掉：聞く 写成「听」丢了「询问」，
// 这行字同时是日常正向题的题面，少一个义项就是教错。第一轮 916 条里 563 条这样。
// 原文本来就有 ≥2 个义项而题面只剩 1 个的，必须在 reason 里写「舍弃义项：<为什么>」。
const senseCount = (text) => text.split(/[；;]/).map((part) => part.trim()).filter(Boolean).length;
const seedMeaning = new Map(seed.map((row) => [`${row[2]}\u0000${row[1]}`, row[0] ?? ""]));
for (const entry of batch) {
  if (entry.classification !== "distinction") continue;
  const original = seedMeaning.get(keyOf(entry));
  if (!original || senseCount(original) < 2 || senseCount(entry.questionMeaning) >= 2) continue;
  if (!/舍弃义项[:：]/u.test(entry.reason ?? "")) {
    errors.push(`sense dropped ${entry.kanji}|${entry.kana}: 「${original}」→「${entry.questionMeaning}」（reason 需写「舍弃义项：…」）`);
  }
}
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
