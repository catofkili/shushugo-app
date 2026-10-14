// 验收用精简版：题干、选项（✔ 标正解）、doubt、解析一句；不印错项说明。node show-compact.cjs <questions.json> [起] [止]
const fs = require("fs"), path = require("path");
const [file, from = 1, to = 999] = process.argv.slice(2);
const qs = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const pass = qs.find((q) => q.passage);
if (pass) { let t = pass.passage; for (const q of qs) if (q.kind === "passage") t = t.replace(`[${q.no}]`, `[${q.no}:${q.options[q.answer - 1]}]`); console.log("【文章(填正解)】\n" + t + "\n"); }
for (const q of qs) {
  if (q.no < +from || q.no > +to) continue;
  const o = q.options.map((x, i) => `${q.answer === i + 1 ? "✔" : ""}${i + 1}.${x}`).join("  ");
  console.log(`#${q.no}[${q.kind.slice(0, 4)}|${q.target ? q.target.surface : ""}] ${q.kind === "passage" ? "" : q.stem}${q.doubt ? "  ⚠️" + q.doubt : ""}\n   ${o}${q.order ? "  顺序" + q.order : ""}`);
}
