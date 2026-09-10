import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const grammarPath = "src/data/grammar.ts";
const rewriteDir = "scripts/grammar-explanation-rewrites";

const parseGrammar = (source) => {
  const marker = "const GRAMMAR_POINTS: GrammarPoint[] =";
  const start = source.indexOf("[", source.indexOf("= [", source.indexOf(marker)));
  const end = source.lastIndexOf("]", source.indexOf("export const grammarPoints"));
  if (start < 0 || end < start) throw new Error("无法定位 grammar.ts 数据数组");
  return JSON.parse(source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
};

const loadRewrites = () => {
  const entries = new Map();
  for (const file of readdirSync(rewriteDir).filter((name) => name.endsWith(".json")).sort()) {
    const payload = JSON.parse(readFileSync(`${rewriteDir}/${file}`, "utf8"));
    for (const [id, explanation] of Object.entries(payload.entries ?? {})) {
      if (entries.has(id)) throw new Error(`重复重写条目: ${id}`);
      entries.set(id, String(explanation).trim());
    }
  }
  return entries;
};

const source = readFileSync(grammarPath, "utf8");
const points = parseGrammar(source);
const rewrites = loadRewrites();
const ids = new Set(points.map((point) => point.id));
for (const id of rewrites.keys()) if (!ids.has(id)) throw new Error(`重写文件含未知 id: ${id}`);
if (rewrites.size !== points.length) throw new Error(`重写条目 ${rewrites.size} != 语法点 ${points.length}`);

for (const point of points) {
  const explanation = rewrites.get(point.id);
  if (!explanation) throw new Error(`${point.id} 缺少新解释`);
  point.explanation = explanation;
  point.usageNotes = [explanation];
}

const marker = "const GRAMMAR_POINTS: GrammarPoint[] =";
const start = source.indexOf("[", source.indexOf("= [", source.indexOf(marker)));
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
for (const point of points) {
  const old = oldById.get(point.id);
  if (!old) throw new Error(`基线缺少语法点: ${point.id}`);
  if (point.explanation === String(old.explanation ?? "").trim()) exactDuplicateCount += 1;
}
if (exactDuplicateCount) throw new Error(`仍有 ${exactDuplicateCount} 条新旧解释完全相同`);

console.log(`✅ 已写入 ${points.length} 条全新语法解释，并同步 usageNotes`);
