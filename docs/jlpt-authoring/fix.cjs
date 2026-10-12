// 验收用：按题号改题。node fix.cjs <questions.json> <改动.js>
// 改动文件：module.exports = { 7: (q, all) => { q.options[1] = "…"; q.distractors["2"] = "…"; } }
const fs = require("fs"), path = require("path");
const [file, patch] = process.argv.slice(2).map((p) => path.resolve(p));
const qs = JSON.parse(fs.readFileSync(file, "utf8"));
for (const [no, edit] of Object.entries(require(patch))) {
  const q = qs.find((x) => x.no === +no);
  if (!q) throw new Error(`没有第 ${no} 题`);
  edit(q, qs);
}
fs.writeFileSync(file, JSON.stringify(qs, null, 2) + "\n");
const counts = [0, 0, 0, 0]; for (const q of qs) counts[q.answer - 1]++;
console.log(`已改 ${Object.keys(require(patch)).length} 题；正解位置 ${counts.join("/")}；doubt ${qs.filter((q) => q.doubt).length}`);
