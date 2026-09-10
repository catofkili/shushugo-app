import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const grammarPath = "src/data/grammar.ts";
const rewriteDir = "scripts/grammar-example-rewrites";

const parseGrammar = (source) => {
  const startMarker = "const GRAMMAR_POINTS: GrammarPoint[] =";
  const start = source.indexOf("[", source.indexOf("= [", source.indexOf(startMarker)));
  const end = source.lastIndexOf("]", source.indexOf("export const grammarPoints"));
  if (start < 0 || end < start) throw new Error("无法定位 grammar.ts 数据数组");
  return JSON.parse(source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
};

const loadRewrites = () => {
  const entries = new Map();
  for (const file of readdirSync(rewriteDir).filter((name) => name.endsWith(".json")).sort()) {
    const payload = JSON.parse(readFileSync(`${rewriteDir}/${file}`, "utf8"));
    const rawEntries = Array.isArray(payload)
      ? Object.fromEntries(payload.map(({ id, examples }) => [id, examples]))
      : (payload.entries ?? {});
    for (const [id, examples] of Object.entries(rawEntries)) {
      if (entries.has(id)) throw new Error(`重复重写条目: ${id}`);
      entries.set(id, examples);
    }
  }
  return entries;
};

const validateExample = (id, index, example) => {
  if (!example || typeof example !== "object") throw new Error(`${id}[${index}] 不是对象`);
  if (!String(example.jp ?? "").trim()) throw new Error(`${id}[${index}] 缺少日文`);
  if (!String(example.cn ?? "").trim()) throw new Error(`${id}[${index}] 缺少中文`);
};

const source = readFileSync(grammarPath, "utf8");
const points = parseGrammar(source);
const rewrites = loadRewrites();
const ids = new Set(points.map((point) => point.id));
for (const id of rewrites.keys()) if (!ids.has(id)) throw new Error(`重写文件含未知 id: ${id}`);
if (rewrites.size !== points.length) throw new Error(`重写条目 ${rewrites.size} != 语法点 ${points.length}`);

let exampleCount = 0;
for (const point of points) {
  const examples = rewrites.get(point.id);
  if (!Array.isArray(examples) || examples.length !== point.examples.length) {
    throw new Error(`${point.id} 新例句数量 ${examples?.length ?? 0} != 旧数量 ${point.examples.length}`);
  }
  examples.forEach((example, index) => validateExample(point.id, index, example));
  point.examples = examples.map(({ jp, cn }) => ({
    jp: String(jp).trim(),
    reading: "",
    cn: String(cn).trim(),
    breakdown: [],
    japanese: String(jp).trim(),
    chinese: String(cn).trim(),
    notes: []
  }));
  exampleCount += examples.length;
}

const startMarker = "const GRAMMAR_POINTS: GrammarPoint[] =";
const start = source.indexOf("[", source.indexOf("= [", source.indexOf(startMarker)));
const end = source.lastIndexOf("]", source.indexOf("export const grammarPoints"));
writeFileSync(grammarPath, `${source.slice(0, start)}${JSON.stringify(points, null, 2)}${source.slice(end + 1)}`);

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const gitGrammarPath = relative(repoRoot, resolve(grammarPath));
const baseline = execFileSync("git", ["show", `HEAD:${gitGrammarPath}`], {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024
});
const oldPoints = parseGrammar(baseline);
const oldById = new Map(oldPoints.map((point) => [point.id, point]));
let exactDuplicateCount = 0;
const newSentences = new Set();
for (const point of points) {
  const old = oldById.get(point.id);
  point.examples.forEach((example, index) => {
    const oldSentence = old?.examples?.[index]?.jp ?? old?.examples?.[index]?.japanese ?? "";
    if (example.jp === oldSentence) exactDuplicateCount += 1;
    if (newSentences.has(example.jp)) throw new Error(`新例句重复: ${point.id}[${index}] ${example.jp}`);
    newSentences.add(example.jp);
  });
}
if (exactDuplicateCount) throw new Error(`仍有 ${exactDuplicateCount} 条新旧日文完全相同`);

console.log(`✅ 已写入 ${points.length} 个语法点 / ${exampleCount} 条独立新例句`);
