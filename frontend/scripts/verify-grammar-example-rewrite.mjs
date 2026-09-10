import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const grammarPath = "src/data/grammar.ts";
const reportPath = "../docs/GRAMMAR_EXAMPLE_REWRITE_COMPARISON.md";

const parseGrammar = (source) => {
  const startMarker = "const GRAMMAR_POINTS: GrammarPoint[] =";
  const start = source.indexOf("[", source.indexOf("= [", source.indexOf(startMarker)));
  const end = source.lastIndexOf("]", source.indexOf("export const grammarPoints"));
  if (start < 0 || end < start) throw new Error("无法定位 grammar.ts 数据数组");
  return JSON.parse(source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
};

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const gitGrammarPath = relative(repoRoot, resolve(grammarPath));
const oldPoints = parseGrammar(execFileSync("git", ["show", `HEAD:${gitGrammarPath}`], {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024
}));
const newPoints = parseGrammar(readFileSync(grammarPath, "utf8"));
const oldById = new Map(oldPoints.map((point) => [point.id, point]));
const newById = new Map(newPoints.map((point) => [point.id, point]));
if (oldById.size !== newById.size) throw new Error(`语法点数量变化: ${oldById.size} -> ${newById.size}`);

const levels = ["N5", "N4", "N3", "N2", "N1"];
const rows = [];
let exactDuplicateCount = 0;
let totalExamples = 0;
for (const point of newPoints) {
  const old = oldById.get(point.id);
  if (!old) throw new Error(`缺少旧条目: ${point.id}`);
  if (old.examples.length !== point.examples.length) throw new Error(`${point.id} 例句数量变化`);
  point.examples.forEach((example, index) => {
    const oldExample = old.examples[index];
    const oldJp = String(oldExample.jp ?? oldExample.japanese ?? "");
    const oldCn = String(oldExample.cn ?? oldExample.chinese ?? "");
    const newJp = String(example.jp ?? example.japanese ?? "");
    const newCn = String(example.cn ?? example.chinese ?? "");
    if (!newJp || !newCn) throw new Error(`${point.id}[${index}] 新例句字段为空`);
    if (newJp === oldJp) exactDuplicateCount += 1;
    rows.push({ level: point.level, id: point.id, index, oldJp, oldCn, newJp, newCn });
    totalExamples += 1;
  });
}
if (exactDuplicateCount) throw new Error(`发现 ${exactDuplicateCount} 条新旧日文完全相同`);

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
const sections = levels.map((level) => {
  const levelRows = rows.filter((row) => row.level === level);
  const body = levelRows.map((row) => `| ${row.id} | ${row.index + 1} | ${escapeCell(row.oldJp)}<br>${escapeCell(row.oldCn)} | ${escapeCell(row.newJp)}<br>${escapeCell(row.newCn)} |`).join("\n");
  return `## ${level}\n\n| 语法 ID | 例句序号 | 旧例句（日文<br>中文） | 新例句（日文<br>中文） |\n|---|---:|---|---|\n${body}`;
});
mkdirSync("../docs", { recursive: true });
writeFileSync(reportPath, `# 语法例句全量重写对照\n\n- 基线：当前分支 HEAD 中的 frontend/src/data/grammar.ts\n- 新版：工作区当前 frontend/src/data/grammar.ts\n- 总数：${totalExamples} 条\n- 规则：新旧日文不得完全相同；保留旧句仅用于本表对照。\n\n${sections.join("\n\n")}\n`);
console.log(`✅ 对照表已生成: ${reportPath} (${totalExamples} 条)`);
