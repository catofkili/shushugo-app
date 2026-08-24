#!/usr/bin/env node
/**
 * 用 JMdict 给本地词库里的「汉字表记 + 读音」计算表记优先级。
 *
 * 这个分数回答的是「这张卡值不值得拿汉字来考读音」，不是词频，也不是 FSRS 难度：
 *   0..15  强假名优先，不进入汉字读音模式
 *  16..34  假名倾向，保留资料但排到汉字卡队尾
 *  35..54  表记混用或证据不足，降低出题优先级
 *  55..100 通常可把汉字作为主表记
 *
 * 用法：
 *   node scripts/audit-kanji-orthography.mjs /path/to/JMdict_e.gz \
 *     --db .local/live.db --out /tmp/kanji-orthography-audit.json
 *
 * 只读打开 SQLite，绝不写回数据库。
 * JMdict © Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

function parseArgs(argv) {
  const args = {
    input: "",
    db: join(frontend, "public", "nihongo.db"),
    out: "",
    runtimeOut: "",
    manual: join(here, "kanji-orthography-manual-review.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") args.db = argv[++i] ?? "";
    else if (arg === "--out") args.out = argv[++i] ?? "";
    else if (arg === "--runtime-out") args.runtimeOut = argv[++i] ?? "";
    else if (arg === "--manual") args.manual = argv[++i] ?? "";
    else if (arg === "--no-manual") args.manual = "";
    else if (!arg.startsWith("--") && !args.input) args.input = arg;
    else throw new Error(`不认识的参数: ${arg}`);
  }
  if (!args.input) throw new Error("用法: node scripts/audit-kanji-orthography.mjs <JMdict_e.gz> [--db <db>] [--out <json>]");
  for (const key of ["input", "db", "out", "runtimeOut", "manual"]) {
    if (args[key] && !isAbsolute(args[key])) args[key] = resolve(process.cwd(), args[key]);
  }
  return args;
}

function buildManualReviewIndex(payload) {
  const index = new Map();
  const add = (decision, key, preferredSurface = null, note = null) => {
    if (index.has(key)) throw new Error(`人工复核重复: ${key}`);
    index.set(key, { decision, preferredSurface, note });
  };
  for (const [key, surface] of Object.entries(payload.kana ?? {})) add("kana", key, surface);
  for (const [key, surface] of Object.entries(payload.low ?? {})) add("low", key, surface);
  for (const [key, surface] of Object.entries(payload.alternate ?? {})) add("alternate", key, surface);
  for (const key of payload.keep ?? []) add("keep", key);
  for (const [key, note] of Object.entries(payload.exclude ?? {})) add("exclude", key, null, note);
  return index;
}

const collect = (block, tag) =>
  [...block.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, "gs"))].map((match) => match[1]);

const entities = (block, tag) => collect(block, tag).map((value) => value.replace(/^&|;$/g, ""));

const normalize = (surface) => surface
  .replace(/\[[^\]]*\]/g, "")
  .replace(/[〜～\s]/g, "")
  .normalize("NFC");

function priorityStrength(tags) {
  let strength = 0;
  for (const tag of tags) {
    if (/^(news|ichi|spec|gai)1$/.test(tag)) strength = Math.max(strength, 4);
    else if (/^(news|ichi|spec|gai)2$/.test(tag)) strength = Math.max(strength, 3);
    else {
      const nf = /^nf(\d\d)$/.exec(tag);
      if (nf) strength = Math.max(strength, 5 - Math.ceil(Number(nf[1]) / 12));
    }
  }
  return strength;
}

function addPairEvidence(index, key, evidence) {
  const current = index.get(key) ?? {
    entries: 0,
    applicableSenses: 0,
    ukSenses: 0,
    nonUkSenses: 0,
    kInfo: new Set(),
    rInfo: new Set(),
    kPriority: new Set(),
    rPriority: new Set(),
    bestSiblingKPriority: 0,
    deprecatedOccurrences: 0,
    oddReadingOccurrences: 0,
    preferredAlternates: new Map()
  };
  current.entries += 1;
  current.applicableSenses += evidence.applicableSenses;
  current.ukSenses += evidence.ukSenses;
  current.nonUkSenses += evidence.nonUkSenses;
  evidence.kInfo.forEach((value) => current.kInfo.add(value));
  evidence.rInfo.forEach((value) => current.rInfo.add(value));
  evidence.kPriority.forEach((value) => current.kPriority.add(value));
  evidence.rPriority.forEach((value) => current.rPriority.add(value));
  current.bestSiblingKPriority = Math.max(current.bestSiblingKPriority, evidence.bestSiblingKPriority);
  if (evidence.deprecated) current.deprecatedOccurrences += 1;
  if (evidence.oddReading) current.oddReadingOccurrences += 1;
  for (const alternate of evidence.preferredAlternates) {
    current.preferredAlternates.set(
      alternate.surface,
      Math.max(current.preferredAlternates.get(alternate.surface) ?? 0, alternate.priority)
    );
  }
  index.set(key, current);
}

function buildJmdictIndex(xml) {
  const index = new Map();
  let entries = 0;
  for (const raw of xml.split("<entry>").slice(1)) {
    const block = raw.split("</entry>", 1)[0];
    const kElements = collect(block, "k_ele").map((element) => ({
      keb: collect(element, "keb")[0] ?? "",
      info: new Set(entities(element, "ke_inf")),
      priority: new Set(collect(element, "ke_pri"))
    })).filter((element) => element.keb);
    if (!kElements.length) continue;

    const readings = collect(block, "r_ele").map((element) => ({
      reb: collect(element, "reb")[0] ?? "",
      restrictions: new Set(collect(element, "re_restr")),
      noKanji: element.includes("<re_nokanji"),
      info: new Set(entities(element, "re_inf")),
      priority: new Set(collect(element, "re_pri"))
    })).filter((element) => element.reb && !element.noKanji);

    const senses = collect(block, "sense").map((sense) => ({
      stagk: new Set(collect(sense, "stagk")),
      stagr: new Set(collect(sense, "stagr")),
      usuallyKana: entities(sense, "misc").includes("uk")
    }));

    for (const reading of readings) {
      const allowed = kElements.filter((element) =>
        !reading.restrictions.size || reading.restrictions.has(element.keb)
      );
      const bestSiblingKPriority = Math.max(0, ...allowed.map((element) => priorityStrength(element.priority)));
      for (const element of allowed) {
        const applicable = senses.filter((sense) =>
          (!sense.stagk.size || sense.stagk.has(element.keb)) &&
          (!sense.stagr.size || sense.stagr.has(reading.reb))
        );
        addPairEvidence(index, `${normalize(element.keb)}|${normalize(reading.reb)}`, {
          applicableSenses: applicable.length,
          ukSenses: applicable.filter((sense) => sense.usuallyKana).length,
          nonUkSenses: applicable.filter((sense) => !sense.usuallyKana).length,
          kInfo: element.info,
          rInfo: reading.info,
          kPriority: element.priority,
          rPriority: reading.priority,
          bestSiblingKPriority,
          deprecated: [...element.info].some((tag) => ["oK", "iK", "rK", "sK"].includes(tag)),
          oddReading: [...reading.info].some((tag) => ["ok", "ik", "sk"].includes(tag)),
          preferredAlternates: allowed
            .filter((candidate) => candidate.keb !== element.keb)
            .filter((candidate) => ![...candidate.info].some((tag) => ["oK", "iK", "rK", "sK"].includes(tag)))
            .map((candidate) => ({ surface: candidate.keb, priority: priorityStrength(candidate.priority) }))
            .filter((candidate) => candidate.priority > 0)
        });
      }
    }
    entries += 1;
  }
  return { index, entries };
}

const OBSOLETE_KANJI = new Set(["oK", "iK"]);
const RARE_KANJI = new Set(["rK", "sK"]);
const ODD_READING = new Set(["ok", "ik", "sk"]);

export function scoreEvidence(evidence) {
  if (!evidence) return {
    score: null,
    band: "unknown",
    confidence: "none",
    reasons: ["JMdict 没有精确匹配这个表记和读音"]
  };

  let score = 60;
  const reasons = [];
  const kInfo = evidence.kInfo;
  const rInfo = evidence.rInfo;
  const allUsuallyKana = evidence.ukSenses > 0 && evidence.nonUkSenses === 0;
  const partlyUsuallyKana = evidence.ukSenses > 0 && evidence.nonUkSenses > 0;
  // 同一“表记|读音”可能存在于多个完全不同的 JMdict 词条。
  // 鏡|かがみ既是普通的“镜子”，也在另一个古义词条里被标 sK；只要有一个正常词条，
  // 就不能把这个表记整体判成罕用。负面 ke_inf/re_inf 只有覆盖全部匹配词条时才生效。
  const obsolete = evidence.deprecatedOccurrences === evidence.entries &&
    [...kInfo].some((tag) => OBSOLETE_KANJI.has(tag));
  const rare = evidence.deprecatedOccurrences === evidence.entries &&
    [...kInfo].some((tag) => RARE_KANJI.has(tag));
  const oddReading = evidence.oddReadingOccurrences === evidence.entries &&
    [...rInfo].some((tag) => ODD_READING.has(tag));
  const exactPriority = priorityStrength(evidence.kPriority);
  const ukRatio = evidence.applicableSenses > 0 ? evidence.ukSenses / evidence.applicableSenses : 0;

  // JMdict 的 uk 是词义级的直接表记证据，权重必须压过词频标签。
  if (allUsuallyKana) {
    score -= 52;
    reasons.push("全部适用义项标记为通常只写假名 (uk)");
  } else if (partlyUsuallyKana) {
    score -= Math.round(20 * ukRatio);
    reasons.push(`部分义项通常写假名 (${evidence.ukSenses}/${evidence.applicableSenses})，表记取决于语义`);
  } else {
    score += 4;
    reasons.push("适用义项没有假名优先标记");
  }

  if (obsolete) {
    score -= 58;
    reasons.push("JMdict 标记为过时或不规则汉字表记");
  } else if (rare) {
    score -= 44;
    reasons.push("JMdict 标记为罕用或检索专用汉字表记");
  }
  if (oddReading) {
    score -= 20;
    reasons.push("当前读音本身被标记为过时或不规则");
  }

  // ke_pri 只说明这个“具体汉字写法”常见，不能抵消 uk / rK / oK。
  if (exactPriority > 0) {
    score += exactPriority * 4;
    reasons.push(`当前汉字写法有 JMdict 优先级证据 (${[...evidence.kPriority].sort().join(", ")})`);
  }
  if (evidence.bestSiblingKPriority > exactPriority) {
    score -= (evidence.bestSiblingKPriority - exactPriority) * 6;
    reasons.push("同读音存在优先级更高的其他汉字写法");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const preferredAlternate = [...evidence.preferredAlternates]
    // 同分时保留 JMdict 的 k_ele 顺序；主表记通常排在变体前面。
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const band = (obsolete || rare) && preferredAlternate ? "alternate"
    : score <= 15 ? "kana" : score <= 34 ? "low" : score <= 54 ? "mixed" : "kanji";
  const confidence = allUsuallyKana || obsolete || rare ? "high"
    : partlyUsuallyKana || oddReading || evidence.bestSiblingKPriority > exactPriority ? "medium"
      : exactPriority >= 3 ? "high" : "medium";
  return { score, band, confidence, preferredSurface: band === "alternate" ? preferredAlternate : null, reasons };
}

function readWords(dbPath) {
  return initSqlJs().then((SQL) => {
    const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));
    try {
      const result = db.exec(`
        SELECT id, kanji, kana, meaning, pos, jlpt_level
        FROM words
        WHERE kanji <> kana
        ORDER BY id
      `)[0];
      if (!result) return [];
      return result.values.map((values) => Object.fromEntries(
        result.columns.map((column, index) => [column, values[index]])
      ));
    } finally {
      db.close();
    }
  });
}

const hasKanji = (text) => /[\u3400-\u9fff]/u.test(normalize(text));
const isLoanwordSource = (word) =>
  /[A-Za-z]/.test(String(word.kanji ?? "")) && /[\u30a0-\u30ff]/u.test(String(word.kana ?? ""));

function applyManualReview(word, automatic, manualIndex) {
  const key = `${word.kanji}|${word.kana}`;
  const baseline = { ...automatic, automatedBand: automatic.band, automatedScore: automatic.score };

  // 835 个外来语行的 kanji 列存的是英文词源，不是日语表记；另有少数纯符号/假名行。
  // 它们应在进入表记算法前排除，否则 “(和) salary+man” 里的“和”会被误认成汉字卡。
  if (isLoanwordSource(word)) return {
    ...baseline,
    score: null,
    band: "not_applicable",
    confidence: "high",
    preferredSurface: String(word.kana ?? ""),
    manualDecision: null,
    reasons: ["kanji 列是外来语词源，不是日语汉字表记"]
  };
  if (!hasKanji(String(word.kanji ?? ""))) return {
    ...baseline,
    score: null,
    band: "not_applicable",
    confidence: "high",
    preferredSurface: String(word.kana ?? ""),
    manualDecision: null,
    reasons: ["表记不含汉字"]
  };

  const manual = manualIndex.get(key);
  if (!manual) return { ...baseline, manualDecision: null };
  const reasons = [...baseline.reasons, `人工复核: ${manual.decision}${manual.note ? ` (${manual.note})` : ""}`];
  if (manual.decision === "exclude") return {
    ...baseline,
    score: null,
    band: "not_applicable",
    confidence: "high",
    preferredSurface: String(word.kana ?? ""),
    manualDecision: "exclude",
    reasons
  };
  if (manual.decision === "keep") return {
    ...baseline,
    score: Math.max(baseline.score ?? 60, 55),
    band: "kanji",
    confidence: "high",
    preferredSurface: null,
    manualDecision: "keep",
    reasons
  };
  if (manual.decision === "alternate") return {
    ...baseline,
    score: Math.min(baseline.score ?? 20, 34),
    band: "alternate",
    confidence: "high",
    preferredSurface: manual.preferredSurface,
    manualDecision: "alternate",
    reasons
  };
  if (manual.decision === "low") return {
    ...baseline,
    score: Math.max(16, Math.min(baseline.score ?? 25, 34)),
    band: "low",
    confidence: "high",
    preferredSurface: manual.preferredSurface,
    manualDecision: "low",
    reasons
  };
  return {
    ...baseline,
    score: Math.min(baseline.score ?? 10, 15),
    band: "kana",
    confidence: "high",
    preferredSurface: manual.preferredSurface,
    manualDecision: "kana",
    reasons
  };
}

const BENCHMARK = [
  ["殆ど", "ほとんど", "kana"], ["下さい", "ください", "kana"],
  ["然し", "しかし", "kana"], ["暫く", "しばらく", "kana"],
  ["勿体ない", "もったいない", "kana"], ["有難う", "ありがとう", "kana"],
  ["此処", "ここ", "kana"], ["其処", "そこ", "kana"],
  ["何処", "どこ", "kana"], ["何時", "いつ", "kana"],
  ["頂く", "いただく", "kana"], ["致す", "いたす", "kana"],
  ["全て", "すべて", "kana"], ["更に", "さらに", "kana"],
  ["随分", "ずいぶん", "kana"], ["勿論", "もちろん", "kana"],
  ["但し", "ただし", "kana"], ["既に", "すでに", "kana"],
  ["所謂", "いわゆる", "kana"], ["迄", "まで", "kana"],
  ["学校", "がっこう", "kanji"], ["日本", "にほん", "kanji"],
  ["時間", "じかん", "kanji"], ["食べる", "たべる", "kanji"],
  ["飲む", "のむ", "kanji"], ["見る", "みる", "kanji"],
  ["行く", "いく", "kanji"], ["来る", "くる", "kanji"],
  ["話す", "はなす", "kanji"], ["書く", "かく", "kanji"],
  ["読む", "よむ", "kanji"], ["大学", "だいがく", "kanji"],
  ["会社", "かいしゃ", "kanji"], ["電車", "でんしゃ", "kanji"],
  ["病院", "びょういん", "kanji"], ["勉強", "べんきょう", "kanji"],
  ["先生", "せんせい", "kanji"], ["学生", "がくせい", "kanji"],
  ["仕事", "しごと", "kanji"], ["名前", "なまえ", "kanji"],
  ["嚙[か]む", "かむ", "alternate", "噛む"], ["搔[か]く", "かく", "kana"],
  ["くみ取る", "くみとる", "alternate", "汲み取る"], ["補塡", "ほてん", "alternate", "補填"]
];

function runBenchmark(rowsByKey) {
  const cases = BENCHMARK.flatMap(([kanji, kana, expected, expectedSurface]) => {
    const row = rowsByKey.get(`${kanji}|${kana}`);
    return row ? [{
      kanji,
      kana,
      expected,
      expectedSurface: expectedSurface ?? null,
      actual: row.priority.band,
      actualSurface: row.priority.preferredSurface,
      score: row.priority.score
    }] : [];
  });
  const strictCorrect = cases.filter((item) =>
    (item.actual === item.expected || (item.expected === "kana" && item.actual === "low")) &&
    (!item.expectedSurface || item.actualSurface === item.expectedSurface)
  ).length;
  // mixed 是算法主动表示“不自动处理”，不算反向误判；另列安全准确率。
  const safeCorrect = cases.filter((item) =>
    item.actual === item.expected || (item.expected === "kana" && item.actual === "low") || item.actual === "mixed"
  ).length;
  const dangerous = cases.filter((item) =>
    (item.expected === "kana" && item.actual === "kanji") ||
    (item.expected === "kanji" && ["kana", "low", "alternate"].includes(item.actual)) ||
    (item.expected === "alternate" && (item.actual === "kanji" ||
      (item.expectedSurface && item.actualSurface !== item.expectedSurface)))
  );
  const meanScore = (expected) => {
    const scores = cases.filter((item) => item.expected === expected).map((item) => item.score);
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  };
  return {
    matched: cases.length,
    strictCorrect,
    strictAccuracy: cases.length ? strictCorrect / cases.length : 0,
    safeCorrect,
    safeAccuracy: cases.length ? safeCorrect / cases.length : 0,
    dangerous,
    meanScore: {
      kana: meanScore("kana"),
      kanji: meanScore("kanji"),
      alternate: meanScore("alternate")
    },
    cases
  };
}

function compactEvidence(evidence) {
  if (!evidence) return null;
  return {
    entries: evidence.entries,
    applicableSenses: evidence.applicableSenses,
    ukSenses: evidence.ukSenses,
    nonUkSenses: evidence.nonUkSenses,
    kInfo: [...evidence.kInfo].sort(),
    rInfo: [...evidence.rInfo].sort(),
    kPriority: [...evidence.kPriority].sort(),
    rPriority: [...evidence.rPriority].sort(),
    bestSiblingKPriority: evidence.bestSiblingKPriority,
    deprecatedOccurrences: evidence.deprecatedOccurrences,
    oddReadingOccurrences: evidence.oddReadingOccurrences,
    preferredAlternates: Object.fromEntries([...evidence.preferredAlternates].sort())
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

const args = parseArgs(process.argv.slice(2));
const xml = gunzipSync(readFileSync(args.input)).toString("utf8");
const { index, entries } = buildJmdictIndex(xml);
const words = await readWords(args.db);
const manualIndex = args.manual
  ? buildManualReviewIndex(JSON.parse(readFileSync(args.manual, "utf8")))
  : new Map();
const rows = words.map((word) => {
  const key = `${normalize(String(word.kanji ?? ""))}|${normalize(String(word.kana ?? ""))}`;
  const evidence = index.get(key);
  const priority = applyManualReview(word, scoreEvidence(evidence), manualIndex);
  if (["kana", "low"].includes(priority.band) && !priority.preferredSurface) {
    priority.preferredSurface = String(word.kana ?? "");
  }
  return {
    id: Number(word.id),
    kanji: String(word.kanji ?? ""),
    kana: String(word.kana ?? ""),
    meaning: String(word.meaning ?? ""),
    pos: String(word.pos ?? ""),
    jlptLevel: word.jlpt_level == null ? null : String(word.jlpt_level),
    priority,
    evidence: compactEvidence(evidence)
  };
});
const rowsByKey = new Map(rows.map((row) => [`${row.kanji}|${row.kana}`, row]));
const bands = ["kana", "low", "alternate", "mixed", "kanji", "unknown", "not_applicable"];
const counts = Object.fromEntries(bands.map((band) => [
  band, rows.filter((row) => row.priority.band === band).length
]));
const automatedCounts = Object.fromEntries(bands.map((band) => [
  band, rows.filter((row) => row.priority.automatedBand === band).length
]));
const benchmark = runBenchmark(rowsByKey);

const report = {
  generatedAt: new Date().toISOString(),
  source: "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
  license: "JMdict © EDRDG, CC BY-SA 4.0 (https://www.edrdg.org/edrdg/licence.html)",
  inputDatabase: args.db,
  algorithm: {
    version: 1,
    scoreMeaning: "0-15=kana, 16-34=low, 35-54=mixed, 55-100=kanji; deprecated forms may be alternate",
    note: "词条表记优先级，不是词频或学习难度；unknown 不自动处理"
  },
  summary: {
    jmdictEntriesWithKanji: entries,
    differingSurfaceWords: rows.length,
    manuallyReviewed: rows.filter((row) => row.priority.manualDecision).length,
    ...counts
  },
  automatedSummary: automatedCounts,
  benchmark,
  rows
};

console.log(`JMdict 建索引: ${entries.toLocaleString()} 条含汉字词条，${index.size.toLocaleString()} 个精确“表记|读音”组合`);
console.log(`词库候选: ${rows.length.toLocaleString()} · 强假名优先 ${counts.kana.toLocaleString()} · 假名倾向 ${counts.low.toLocaleString()} · 改用标准汉字 ${counts.alternate.toLocaleString()} · 混合 ${counts.mixed.toLocaleString()} · 汉字优先 ${counts.kanji.toLocaleString()} · 未匹配 ${counts.unknown.toLocaleString()} · 非汉字表记 ${counts.not_applicable.toLocaleString()}`);
console.log(`人工逐条复核: ${rows.filter((row) => row.priority.manualDecision).length.toLocaleString()} 条`);
console.log(`人工独立样本: 命中 ${benchmark.matched}/${BENCHMARK.length} · 严格准确率 ${percent(benchmark.strictAccuracy)} · 安全准确率 ${percent(benchmark.safeAccuracy)} · 危险反判 ${benchmark.dangerous.length}`);
console.log(`样本平均分: 假名 ${benchmark.meanScore.kana?.toFixed(1) ?? "-"} · 汉字 ${benchmark.meanScore.kanji?.toFixed(1) ?? "-"} · 异体修正 ${benchmark.meanScore.alternate?.toFixed(1) ?? "-"}`);

for (const band of ["kana", "low", "alternate", "mixed"]) {
  const heading = band === "kana" ? "强假名优先"
    : band === "low" ? "假名倾向（仍保留为低优先级资料）"
    : band === "alternate" ? "建议改用标准汉字"
      : "建议暂缓自动加入";
  console.log(`\n${heading}（前 35 个）:`);
  rows
    .filter((row) => row.priority.band === band)
    .sort((left, right) => left.priority.score - right.priority.score || left.id - right.id)
    .slice(0, 35)
    .forEach((row) => console.log(`${String(row.priority.score).padStart(2)}  ${row.kanji}【${row.kana}】${row.priority.preferredSurface ? ` → ${row.priority.preferredSurface}` : ""}  ${row.meaning}`));
}

if (benchmark.dangerous.length) {
  console.log("\n人工样本中的危险反判:");
  benchmark.dangerous.forEach((item) => console.log(`${item.kanji}【${item.kana}】 expected=${item.expected} actual=${item.actual} score=${item.score}`));
}

if (args.out) {
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n完整审计写到 ${args.out}`);
}

if (args.runtimeOut) {
  const entries = Object.fromEntries(rows.flatMap((row) =>
    ["kana", "low", "alternate"].includes(row.priority.band)
      ? [[`${row.kanji}|${row.kana}`, {
          band: row.priority.band,
          score: row.priority.score,
          preferredSurface: row.priority.preferredSurface
        }]]
      : []
  ));
  writeFileSync(args.runtimeOut, `${JSON.stringify({
    source: "JMdict © EDRDG, CC BY-SA 4.0",
    sourceUrl: "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
    generatedBy: "frontend/scripts/audit-kanji-orthography.mjs",
    manualReview: "frontend/scripts/kanji-orthography-manual-review.json",
    entries
  })}\n`, "utf8");
  console.log(`运行时表记表写到 ${args.runtimeOut} (${Object.keys(entries).length} 条)`);
}
