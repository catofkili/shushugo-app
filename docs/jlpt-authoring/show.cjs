// 验收用：逐题打印一份 questions.json。node show.cjs <questions.json> [起始题号] [结束题号]
// （放在流水线目录，不放 /tmp：10-08 发现 scratchpad 里的旧版随重启没了）
const fs = require("fs"), path = require("path");
const [file, from = 1, to = 999] = process.argv.slice(2);
const qs = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
for (const q of qs) {
  if (q.no < +from || q.no > +to) continue;
  if (q.passage) console.log(`\n【文章】\n${q.passage}\n`);
  console.log(`#${q.no} [${q.kind}] ${q.target ? q.target.surface : "-"}${q.doubt ? "  ⚠️doubt: " + q.doubt : ""}`);
  console.log(`  ${q.stem}`);
  q.options.forEach((o, i) => console.log(`  ${i + 1 === q.answer ? "✔" : " "}${i + 1}. ${o}${q.distractors[i + 1] ? "　— " + q.distractors[i + 1] : ""}`));
  if (q.order) console.log(`  顺序：${q.order.map((n) => q.options[n - 1]).join(" ")}`);
  console.log(`  解：${q.explanation}`);
}
