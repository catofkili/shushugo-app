#!/usr/bin/env node
/**
 * 从本地 JMdict 和出厂词库生成拼写题的额外合法写法与其它读音。
 * spelling_forms.json 的 entries[key] 是 { f: [[表记, tag], ...], r: [其它平假名读音, ...] }；
 * key 为清理后的「词库表记|读音」，f 只存词库主表记之外的汉字写法。
 *
 * 纯假名词只有在读音唯一对应一个条目时才取 JMdict 汉字写法；
 * 精确汉字+读音若撞上多个条目也跳过，避免把不同词义的表记混在一起。
 * 数据库仅在内存中只读查询，不调用 export 或任何写入接口。
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");
const repo = join(frontend, "..");
const sourcePath = join(frontend, ".local/JMdict_e.gz");
const databasePath = join(frontend, "public/nihongo.db");
const outputPath = join(frontend, "src/data/spelling_forms.json");
const reportPath = join(repo, "docs/audits/2026-10-02-spelling-forms.md");
const VERSION = "2026-10-02";
const TAG_ORDER = ["variant", "rare", "ateji"];
const TAG_RANK = new Map(TAG_ORDER.map((tag, index) => [tag, index]));
const EXCLUDED_KANJI_INFO = new Set(["sK", "iK", "oK"]);
const EXCLUDED_READING_INFO = new Set(["ok", "ik", "sk"]);
const HAN = /\p{Script=Han}/u;
const NON_WORD_MARKS = /[〜～~・\s]/gu;

const orthographyEntries = JSON.parse(
  readFileSync(join(frontend, "src/data/kanji_orthography.json"), "utf8")
).entries;

const stableTextOrder = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const cleanWordSurface = (surface) =>
  surface.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "") || surface;
const normalizeSurface = (surface) =>
  cleanWordSurface(surface).replace(NON_WORD_MARKS, "").normalize("NFC");

function toHiragana(text) {
  return [...text].map((char) => {
    const code = char.codePointAt(0);
    if ((code >= 0x30a1 && code <= 0x30f6) || (code >= 0x30fd && code <= 0x30fe)) {
      return String.fromCodePoint(code - 0x60);
    }
    return char;
  }).join("");
}

const normalizeReading = (reading) =>
  toHiragana(cleanWordSurface(reading).replace(NON_WORD_MARKS, "")).normalize("NFC");
const isHiraganaReading = (reading) => /^[\u3041-\u3096\u309d-\u309f]+$/u.test(reading);
const hasKanji = (surface) => HAN.test(surface);
const isLoanword = (word) => /[A-Za-z]/.test(word.kanji) && /[\u30a0-\u30ff]/u.test(word.kana);
const isKatakanaReading = (reading) =>
  /[\u30a1-\u30fa\u30fd\u30fe]/u.test(reading) && /^[\u30a0-\u30ffー]+$/u.test(reading);

function collect(block, tag) {
  return [...block.matchAll(new RegExp("<" + tag + "(?:\\s[^>]*)?>(.*?)</" + tag + ">", "gs"))]
    .map((match) => match[1]);
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([\da-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)));
}

const elementText = (block, tag) => decodeXmlText(collect(block, tag)[0] ?? "");
const infoTags = (block, tag) =>
  new Set(collect(block, tag).map((value) => value.replace(/^&|;$/g, "")));

function parseEntry(block) {
  const kanji = collect(block, "k_ele").map((element) => ({
    surface: elementText(element, "keb"),
    info: infoTags(element, "ke_inf")
  })).filter((element) => element.surface);
  const readings = collect(block, "r_ele").map((element) => ({
    reading: elementText(element, "reb"),
    restrictions: new Set(collect(element, "re_restr").map(decodeXmlText)),
    noKanji: /<re_nokanji(?:\s*\/)?\s*>/u.test(element),
    info: infoTags(element, "re_inf")
  })).filter((element) => element.reading);
  return { id: elementText(block, "ent_seq"), kanji, readings };
}

function addToIndex(index, key, value) {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function buildJmDictIndex(xml) {
  const byReading = new Map();
  const exactPairs = new Map();
  const unrestrictedPairs = new Map();
  const infoCounts = { kanji: {}, reading: {} };
  let entryCount = 0;
  let reRestrictionCount = 0;
  let reNoKanjiCount = 0;

  let offset = 0;
  while (true) {
    const start = xml.indexOf("<entry>", offset);
    if (start < 0) break;
    const end = xml.indexOf("</entry>", start);
    if (end < 0) throw new Error("JMdict entry 没有闭合标签");
    const entry = parseEntry(xml.slice(start + 7, end));
    offset = end + 8;
    entryCount += 1;

    for (const kanji of entry.kanji) {
      for (const tag of kanji.info) infoCounts.kanji[tag] = (infoCounts.kanji[tag] ?? 0) + 1;
    }
    for (const reading of entry.readings) {
      for (const tag of reading.info) infoCounts.reading[tag] = (infoCounts.reading[tag] ?? 0) + 1;
      reRestrictionCount += reading.restrictions.size;
      if (reading.noKanji) reNoKanjiCount += 1;

      const readingKey = normalizeReading(reading.reading);
      let entryReadings = byReading.get(readingKey);
      if (!entryReadings) {
        entryReadings = new Map();
        byReading.set(readingKey, entryReadings);
      }
      const storedEntry = entryReadings.get(entry.id) ?? { entry, readings: [] };
      storedEntry.readings.push(reading);
      entryReadings.set(entry.id, storedEntry);

      if (reading.noKanji) continue;
      for (const kanji of entry.kanji) {
        const key = normalizeSurface(kanji.surface) + "|" + readingKey;
        addToIndex(unrestrictedPairs, key, { entry, kanji, reading });
        if (canReadKanji(reading, kanji.surface)) {
          addToIndex(exactPairs, key, { entry, kanji, reading });
        }
      }
    }
  }

  return {
    byReading,
    exactPairs,
    unrestrictedPairs,
    infoCounts,
    entryCount,
    reRestrictionCount,
    reNoKanjiCount
  };
}

function readWords(SQL) {
  const db = new SQL.Database(new Uint8Array(readFileSync(databasePath)));
  try {
    const result = db.exec("SELECT id, kanji, kana, importance FROM words ORDER BY id")[0];
    if (!result) throw new Error("nihongo.db 没有 words 表或词条");
    const columnIndex = Object.fromEntries(result.columns.map((name, index) => [name, index]));
    return result.values.map((row) => ({
      id: Number(row[columnIndex.id]),
      kanji: String(row[columnIndex.kanji]),
      kana: String(row[columnIndex.kana]),
      importance: Number(row[columnIndex.importance])
    }));
  } finally {
    db.close();
  }
}

function formTag(kanji) {
  if ([...kanji.info].some((tag) => EXCLUDED_KANJI_INFO.has(tag))) return null;
  if (kanji.info.has("rK")) return "rare";
  if (kanji.info.has("ateji")) return "ateji";
  return "variant";
}

function addForm(record, baseSurface, surface, tag) {
  const cleaned = cleanWordSurface(surface);
  if (!cleaned || cleaned === baseSurface || !hasKanji(cleaned)) return;
  const previous = record.forms.get(cleaned);
  if (!previous || TAG_RANK.get(tag) < TAG_RANK.get(previous)) record.forms.set(cleaned, tag);
}

function canReadKanji(reading, surface) {
  if (reading.noKanji) return false;
  if (!reading.restrictions.size) return true;
  const allowed = new Set([...reading.restrictions].map(normalizeSurface));
  return allowed.has(normalizeSurface(surface));
}

const readingIsAllowed = (reading) =>
  ![...reading.info].some((tag) => EXCLUDED_READING_INFO.has(tag));

function sortedForms(record) {
  return [...record.forms].sort(([leftSurface, leftTag], [rightSurface, rightTag]) =>
    TAG_RANK.get(leftTag) - TAG_RANK.get(rightTag) ||
    stableTextOrder(leftSurface, rightSurface)
  );
}

function buildAuditAndPayload(words, index) {
  const records = new Map();
  const rowResults = [];
  const exactConflicts = new Map();
  const unmatchedCounts = {
    multiple_exact_entries: 0,
    multiple_reading_entries: 0,
    no_exact_keb_reading: 0,
    blocked_by_re_restr: 0,
    reading_not_in_jmdict: 0
  };
  let exactMatchedRows = 0;
  let uniqueReadingRows = 0;

  for (const word of words) {
    const baseSurface = cleanWordSurface(word.kanji);
    const surfaceKey = normalizeSurface(word.kanji);
    const readingKey = normalizeReading(word.kana);
    const key = surfaceKey + "|" + normalizeSurface(word.kana);
    const wordHasKanji = !isLoanword(word) && hasKanji(surfaceKey);
    const record = records.get(key) ?? {
      key,
      word,
      baseSurface,
      forms: new Map(),
      altReadings: new Set()
    };
    records.set(key, record);

    const orthography = orthographyEntries[word.kanji + "|" + word.kana];
    if (orthography && ["alternate", "kana", "low"].includes(orthography.band)) {
      addForm(record, baseSurface, orthography.preferredSurface, "variant");
    }

    if (wordHasKanji) {
      const pairKey = surfaceKey + "|" + readingKey;
      const candidates = index.exactPairs.get(pairKey) ?? [];
      const candidateEntries = new Map(candidates.map((candidate) => [candidate.entry.id, candidate.entry]));
      if (candidateEntries.size > 1) {
        unmatchedCounts.multiple_exact_entries += 1;
        exactConflicts.set(pairKey, { word, candidates: [...candidateEntries.values()] });
        rowResults.push({ word, hasKanji: true, status: "multiple_exact_entries" });
        continue;
      }
      if (!candidateEntries.size) {
        const reason = (index.unrestrictedPairs.get(pairKey)?.length ?? 0) > 0
          ? "blocked_by_re_restr"
          : "no_exact_keb_reading";
        unmatchedCounts[reason] += 1;
        rowResults.push({ word, hasKanji: true, status: reason });
        continue;
      }

      const entry = candidateEntries.values().next().value;
      const matchingReads = candidates.filter((candidate) => candidate.entry.id === entry.id);
      for (const candidate of matchingReads) {
        for (const kanji of entry.kanji) {
          if (canReadKanji(candidate.reading, kanji.surface)) {
            const tag = formTag(kanji);
            if (tag) addForm(record, baseSurface, kanji.surface, tag);
          }
        }
      }
      for (const reading of entry.readings) {
        const normalized = normalizeReading(reading.reading);
        if (normalized === readingKey || !readingIsAllowed(reading) || !canReadKanji(reading, word.kanji)) {
          continue;
        }
        if (isHiraganaReading(normalized)) record.altReadings.add(normalized);
      }
      exactMatchedRows += 1;
      rowResults.push({ word, hasKanji: true, status: "exact_unique" });
      continue;
    }

    const readingEntries = [...(index.byReading.get(readingKey)?.values() ?? [])];
    if (readingEntries.length > 1) {
      unmatchedCounts.multiple_reading_entries += 1;
      rowResults.push({ word, hasKanji: false, status: "multiple_reading_entries" });
      continue;
    }
    if (!readingEntries.length) {
      unmatchedCounts.reading_not_in_jmdict += 1;
      rowResults.push({ word, hasKanji: false, status: "reading_not_in_jmdict" });
      continue;
    }

    for (const reading of readingEntries[0].readings) {
      if (normalizeReading(reading.reading) !== readingKey || reading.noKanji) continue;
      for (const kanji of readingEntries[0].entry.kanji) {
        if (!canReadKanji(reading, kanji.surface)) continue;
        const tag = formTag(kanji);
        if (tag) addForm(record, baseSurface, kanji.surface, tag);
      }
    }
    uniqueReadingRows += 1;
    rowResults.push({ word, hasKanji: false, status: "reading_unique" });
  }

  for (const record of records.values()) {
    if (isKatakanaReading(normalizeSurface(record.word.kana)) || isLoanword(record.word)) {
      record.altReadings.clear();
    }
  }

  const entries = Object.fromEntries(
    [...records.values()]
      .sort((left, right) => stableTextOrder(left.key, right.key))
      .flatMap((record) => {
        const value = {};
        const forms = sortedForms(record);
        const altReadings = [...record.altReadings].sort(stableTextOrder);
        if (forms.length) value.f = forms;
        if (altReadings.length) value.r = altReadings;
        return Object.keys(value).length ? [[record.key, value]] : [];
      })
  );

  return {
    records: [...records.values()],
    entries,
    rowResults,
    exactConflicts,
    unmatchedCounts,
    exactMatchedRows,
    uniqueReadingRows
  };
}

function seededSample(items, count, seed) {
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.slice(0, count).sort((left, right) =>
    stableTextOrder(left.record.key + "|" + left.surface, right.record.key + "|" + right.surface)
  );
}

const reportSurface = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const wordLabel = (word) =>
  reportSurface(cleanWordSurface(word.kanji)) + "｜" +
  reportSurface(cleanWordSurface(word.kana));
const formatCount = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function createReport(words, index, result) {
  const additions = Object.fromEntries(TAG_ORDER.map((tag) => [tag, []]));
  let altReadingCount = 0;
  const recordByKey = new Map(result.records.map((record) => [record.key, record]));
  for (const record of result.records) {
    for (const [surface, tag] of record.forms) additions[tag].push({ record, surface });
    altReadingCount += record.altReadings.size;
  }
  const counts = Object.fromEntries(TAG_ORDER.map((tag) => [tag, additions[tag].length]));
  const randomSeed = 0x5a170202;
  const kanjiInfoSummary = Object.entries(index.infoCounts.kanji)
    .sort(([left], [right]) => stableTextOrder(left, right))
    .map(([tag, count]) => tag + " " + formatCount(count))
    .join("、") || "无";
  const readingInfoSummary = Object.entries(index.infoCounts.reading)
    .sort(([left], [right]) => stableTextOrder(left, right))
    .map(([tag, count]) => tag + " " + formatCount(count))
    .join("、") || "无";
  const lines = [
    "# 被接受写法数据审计",
    "",
    "> 生成日期：2026-10-02。构建脚本固定随机种子 0x5a170202，重复生成内容稳定。",
    "> spelling_forms.json 的 entries[key] 为 { f: [[表记, tag], ...], r: [其它读音, ...] }；f 只存主表记之外的汉字写法。",
    "",
    "## 取数与判定口径",
    "",
    "- 输入仅为 frontend/.local/JMdict_e.gz 与只读内存打开的 frontend/public/nihongo.db；词库清理去 [注音] 和空白，匹配键再去 〜、～、~、・。片假名读音转平假名参与 JMdict 匹配，输出键保留词库原读音。",
    "- 含汉字词按清理后的表记+读音匹配，并尊重 re_restr。一个精确键对应多个 ent_seq 时丢弃该键的 JMdict 写法和其它读音；纯假名/外来语只在读音唯一对应一个条目时取其可配表记。",
    "- 排除 ke_inf 的 sK/iK/oK；rK 归 rare，ateji 归 ateji，其它未排除标签归 variant。同一写法重复出现时采用更常规的标签顺序 variant → rare → ateji。",
    "- 排除 re_inf 的 ok/ik/sk；其它且能配该汉字表记的平假名读音才进入 r。假名表记无法由 re_restr 证明是同一字形，故不推导 altReadings；片假名读音也始终为空。",
    "- kanji_orthography.json 的 alternate/kana/low 首选表记若含汉字，也按 variant 并入；纯假名首选表记不放入 f。",
    "",
    "## 规模与标签",
    "",
    "- JMdict：" + formatCount(index.entryCount) + " 个 entry；词库：" + formatCount(words.length) +
      " 行、规范键 " + formatCount(result.records.length) + " 个；产物含新增内容的键 " +
      formatCount(Object.keys(result.entries).length) + " 个。",
    "- 唯一 JMdict 匹配：含汉字的精确匹配 " + formatCount(result.exactMatchedRows) + " 行；读音唯一匹配 " + formatCount(result.uniqueReadingRows) + " 行；合计 " + formatCount(result.exactMatchedRows + result.uniqueReadingRows) + " 行。",
    "- 丢弃歧义：同音多条目 " + formatCount(result.unmatchedCounts.multiple_reading_entries) + " 行；同一精确汉字+读音有多个条目 " + formatCount(result.unmatchedCounts.multiple_exact_entries) + " 行。",
    "- 未匹配原因：无对应读音条目 " + formatCount(result.unmatchedCounts.reading_not_in_jmdict) +
      " 行；无精确表记+读音 " + formatCount(result.unmatchedCounts.no_exact_keb_reading) +
      " 行；被 re_restr 阻断 " + formatCount(result.unmatchedCounts.blocked_by_re_restr) + " 行。",
    "- 新增汉字写法（按输出键+表记计）：standard 0、variant " + formatCount(counts.variant) +
      "、rare " + formatCount(counts.rare) + "、ateji " + formatCount(counts.ateji) +
      "；其它读音 " + formatCount(altReadingCount) + " 条。",
    "",
    "JMdict 实际标签出现次数（按标签元素计）：",
    "",
    "- ke_inf：" + kanjiInfoSummary + "。k_ele 还含 keb 与 ke_pri；未发现其它子标签。",
    "- re_inf：" + readingInfoSummary + "。r_ele 含 reb、re_pri、re_restr（" +
      formatCount(index.reRestrictionCount) + " 个限制）与 re_nokanji（" +
      formatCount(index.reNoKanjiCount) + " 个标记）。",
    "",
    "**需人工拍板的规则点：** 数据中 ke_inf 另有 io（不规则送り仮名，809 次）和小写 ik（6 次），不在 §1.5 明确排除的 sK/iK/oK 中；当前依规格兜底规则都归 variant。例如 其後、或日、異る带 io，它们不是搜索用的 sK。如不希望学习者接受不规则送り仮名，可在下一版明确把 io 列入排除集。re_inf 另有 gikun 与 rk（222 次）；因规格只排除 ok/ik/sk，当前 rk 会作为其它读音纳入。另有一条 orthography 的 kana 档词形 擦り抜ける → すり抜ける 仍含汉字；按“surface 含汉字则 standard”的明确规则，当前把 すり抜ける 列为 standard、词库原表记列为 variant。若要以 band=kana 优先词库主表记，这处需统一口径。",
    "",
    "## 各标签新增写法样本",
    "",
    "每类从全部新增词形中用固定种子 0x" + randomSeed.toString(16) + " 抽取至多 40 条；样本按词库表记和新增写法排序展示。",
    ""
  ];

  for (const tag of TAG_ORDER) {
    lines.push("### " + tag + "（" + formatCount(counts[tag]) + " 条）", "");
    for (const item of seededSample(additions[tag], 40, randomSeed ^ tag.charCodeAt(0))) {
      lines.push("- " + wordLabel(item.record.word) + " → " + reportSurface(item.surface));
    }
    if (!counts[tag]) lines.push("- 无");
    lines.push("");
  }

  const specialLoanwordForms = [];
  for (const row of result.rowResults) {
    if (row.hasKanji || row.status !== "reading_unique") continue;
    const record = recordByKey.get(normalizeSurface(row.word.kanji) + "|" + normalizeSurface(row.word.kana));
    if (!record) continue;
    for (const [surface, tag] of record.forms) {
      if (tag === "rare" || tag === "ateji") specialLoanwordForms.push({ word: row.word, surface, tag });
    }
  }
  const specialSorted = specialLoanwordForms.sort((left, right) =>
    left.word.id - right.word.id || stableTextOrder(left.surface, right.surface)
  );
  lines.push(
    "## 假名词 / 外来语中读音唯一且新增 rare / ateji 的全部条目",
    "",
    "共 " + formatCount(specialSorted.length) + " 条；最多列出 80 条，按词库 id 排序。",
    ""
  );
  for (const item of specialSorted.slice(0, 80)) {
    lines.push("- #" + item.word.id + " " + wordLabel(item.word) + " → " +
      reportSurface(item.surface) + "（" + item.tag + "）");
  }
  if (!specialSorted.length) lines.push("- 无");
  lines.push("");

  lines.push(
    "## 精确汉字+读音多条目冲突清单",
    "",
    "以下键不取任何 JMdict 变体或其它读音，只保留词库与 orthography 写法。候选列展示每个 ent_seq 中按标签规则原本可加入的其它汉字表记。",
    ""
  );
  for (const [key, conflict] of [...result.exactConflicts].sort(([left], [right]) =>
    stableTextOrder(left, right)
  )) {
    const candidates = conflict.candidates.map((entry) => {
      const alternatives = entry.kanji.flatMap((kanji) => {
        const tag = formTag(kanji);
        return tag && hasKanji(kanji.surface) &&
          normalizeSurface(kanji.surface) !== normalizeSurface(conflict.word.kanji)
          ? [reportSurface(cleanWordSurface(kanji.surface)) + " (" + tag + ")"]
          : [];
      });
      return entry.id + ": " + (alternatives.join(", ") || "无额外表记");
    });
    lines.push("- #" + conflict.word.id + " " + reportSurface(key.replace("|", "｜")) +
      " — " + candidates.join("；"));
  }
  if (!result.exactConflicts.size) lines.push("- 无");
  lines.push("");

  const unmatchedImportant = result.rowResults
    .filter((row) => row.status !== "exact_unique" && row.status !== "reading_unique" &&
      !isLoanword(row.word) &&
      hasKanji(cleanWordSurface(row.word.kanji)))
    .sort((left, right) =>
      right.word.importance - left.word.importance || left.word.id - right.word.id
    )
    .slice(0, 30);
  lines.push(
    "## 未取得唯一 JMdict 匹配的高 importance 汉字词",
    "",
    "按 importance 降序、id 升序取前 30 条。",
    ""
  );
  for (const row of unmatchedImportant) {
    lines.push("- #" + row.word.id + " importance " + row.word.importance + "：" +
      wordLabel(row.word) + "（" + row.status + "）");
  }
  if (!unmatchedImportant.length) lines.push("- 无");
  lines.push("");

  return lines.join("\n") + "\n";
}

const SQL = await initSqlJs();
const words = readWords(SQL);
const xml = gunzipSync(readFileSync(sourcePath)).toString("utf8");
const index = buildJmDictIndex(xml);
const result = buildAuditAndPayload(words, index);
const payload = {
  version: VERSION,
  source: "JMdict © EDRDG, CC BY-SA 4.0",
  entries: result.entries
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload) + "\n", "utf8");
writeFileSync(reportPath, createReport(words, index, result), "utf8");

const byteSize = statSync(outputPath).size;
console.log(
  "spelling_forms.json: " + formatCount(byteSize) + " bytes; " +
  formatCount(Object.keys(payload.entries).length) + " keys; " +
  formatCount(result.exactMatchedRows + result.uniqueReadingRows) + "/" +
  formatCount(words.length) + " unique JMdict matches; " +
  formatCount(result.unmatchedCounts.multiple_exact_entries +
    result.unmatchedCounts.multiple_reading_entries) + " ambiguous; altReadings " +
  formatCount([...result.records].reduce((sum, record) => sum + record.altReadings.size, 0))
);
