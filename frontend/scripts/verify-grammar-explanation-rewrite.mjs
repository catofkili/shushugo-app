import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const grammarPath = "src/data/grammar.ts";
const reportPath = "../docs/GRAMMAR_EXPLANATION_REWRITE_COMPARISON.md";

const parseGrammar = (source) => {
  const marker = "const GRAMMAR_POINTS: GrammarPoint[] =";
  const start = source.indexOf("[", source.indexOf("= [", source.indexOf(marker)));
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
for (const point of newPoints) {
  const old = oldById.get(point.id);
  if (!old) throw new Error(`缺少旧条目: ${point.id}`);
  const explanation = String(point.explanation ?? "").trim();
  if (!explanation) throw new Error(`${point.id} 新解释为空`);
  if (!Array.isArray(point.usageNotes) || point.usageNotes.length !== 1 || point.usageNotes[0] !== explanation) {
    throw new Error(`${point.id} usageNotes 未与新解释同步`);
  }
  if (explanation === String(old.explanation ?? "").trim()) exactDuplicateCount += 1;
  rows.push({
    level: point.level,
    id: point.id,
    title: point.title,
    meaning: point.meaning,
    structure: point.structure,
    oldExplanation: String(old.explanation ?? ""),
    newExplanation: explanation
  });
}
if (exactDuplicateCount) throw new Error(`发现 ${exactDuplicateCount} 条新旧解释完全相同`);

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
const sections = levels.map((level) => {
  const levelRows = rows.filter((row) => row.level === level);
  const body = levelRows.map((row) => `| ${row.id} | ${escapeCell(row.title)} | ${escapeCell(row.meaning)} | ${escapeCell(row.oldExplanation)} | ${escapeCell(row.newExplanation)} |`).join("\n");
  return `## ${level}\n\n| 语法 ID | 语法点 | 含义 | 旧解释（仅供对照） | 新解释 |\n|---|---|---|---|---|\n${body}`;
});
mkdirSync("../docs", { recursive: true });
writeFileSync(reportPath, `# 语法解释全量重写对照\n\n- 基线：当前分支 HEAD 中的 frontend/src/data/grammar.ts\n- 新版：工作区当前 frontend/src/data/grammar.ts\n- 总数：${rows.length} 条\n- 规则：新解释依据语法点标题、含义和接续独立手写；旧解释仅在本表中作为完成后的对照。\n- 同步：每个语法点的 usageNotes 已替换为对应的新解释。\n\n${sections.join("\n\n")}\n`);
console.log(`✅ 解释对照表已生成: ${reportPath} (${rows.length} 条)`);
