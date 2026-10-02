#!/usr/bin/env node
// 由本地 OpenCC 字典和 KANJIDIC 键生成拼写题专用的保守字形映射。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sourceDir = join(here, "kanji-variant-sources");
const readings = JSON.parse(readFileSync(join(root, "src/data/kanji_readings.json"), "utf8")).readings;
const variants = JSON.parse(readFileSync(join(root, "src/data/kanji_variants.json"), "utf8"))
  .japanese_to_simplified;

function readOpenCC(fileName) {
  const map = new Map();
  for (const line of readFileSync(join(sourceDir, fileName), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [key, rawValues] = line.split("\t");
    if (key && rawValues && [...key].length === 1) {
      map.set(key, rawValues.trim().split(/\s+/).filter((value) => [...value].length === 1));
    }
  }
  return map;
}

const japanese = new Set(Object.keys(readings));
const simplifiedCandidates = new Map();
for (const [japaneseChar, simplifiedChar] of Object.entries(variants)) {
  if (!japanese.has(japaneseChar)) continue;
  simplifiedCandidates.set(simplifiedChar, [
    ...(simplifiedCandidates.get(simplifiedChar) ?? []),
    japaneseChar
  ]);
}

const simplifiedToJapanese = new Map();
for (const [simplified, candidates] of simplifiedCandidates) {
  const unique = [...new Set(candidates)];
  if (unique.length === 1 && !japanese.has(simplified)) simplifiedToJapanese.set(simplified, unique[0]);
}

const directTraditionalCandidates = new Map();
for (const [japaneseChar, variantsForChar] of readOpenCC("JPShinjitaiCharacters.txt")) {
  if (!japanese.has(japaneseChar)) continue;
  for (const traditional of variantsForChar) {
    if (traditional === japaneseChar || japanese.has(traditional)) continue;
    directTraditionalCandidates.set(traditional, [
      ...(directTraditionalCandidates.get(traditional) ?? []),
      japaneseChar
    ]);
  }
}

const traditionalCandidates = new Map();
for (const [traditional, simplifiedChars] of readOpenCC("TSCharacters.txt")) {
  if (japanese.has(traditional)) continue;
  const candidates = new Set(
    simplifiedChars.flatMap((simplified) => simplifiedCandidates.get(simplified) ?? [])
  );
  if (candidates.size) traditionalCandidates.set(traditional, [...candidates]);
}

const traditionalToJapanese = new Map();
for (const traditional of new Set([
  ...directTraditionalCandidates.keys(),
  ...traditionalCandidates.keys()
])) {
  // OpenCC 的 JP 新旧字体表能消解繁简表中 發/髮一类的一简多繁冲突。
  const direct = [...new Set(directTraditionalCandidates.get(traditional) ?? [])];
  const fallback = [...new Set(traditionalCandidates.get(traditional) ?? [])];
  const candidates = direct.length ? direct : fallback;
  // 同一个输入若既像简体又像繁体，单字信息不足以安全判断。
  if (candidates.length === 1 && !simplifiedToJapanese.has(traditional)) {
    traditionalToJapanese.set(traditional, candidates[0]);
  }
}

const byCodePoint = (left, right) => left.codePointAt(0) - right.codePointAt(0);
const sortedObject = (map) => Object.fromEntries(
  [...map].sort(([left], [right]) => byCodePoint(left, right))
);
const output = {
  japaneseCharacters: [...japanese].sort(byCodePoint).join(""),
  simplifiedToJapanese: sortedObject(simplifiedToJapanese),
  traditionalToJapanese: sortedObject(traditionalToJapanese)
};

writeFileSync(
  join(root, "src/data/spelling_kanji_forms.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8"
);
console.log(
  "spelling_kanji_forms.json: " + [...output.japaneseCharacters].length + " Japanese kanji, " +
  simplifiedToJapanese.size + " simplified forms, " + traditionalToJapanese.size + " traditional forms"
);
