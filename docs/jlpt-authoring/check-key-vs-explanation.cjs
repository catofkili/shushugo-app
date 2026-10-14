// 审校改了选项没改 answer 的粗筛：解析里引的是另一个选项、正解选项的文字却没出现 → 报出来（需要人看）。
// 排序题看 order 对应的 ★ 选项，不看这一条。
const fs = require("fs"), path = require("path");
let bad = 0, total = 0;
for (const f of process.argv.slice(2)) {
  for (const q of JSON.parse(fs.readFileSync(f))) {
    if (q.kind === "sentence-order" || q.order) continue;
    total++;
    const hit = q.options.map((o) => o.length >= 2 && q.explanation.includes(o.replace(/^[～〜]/, "")));
    const mine = hit[q.answer - 1], others = hit.filter((h, i) => h && i !== q.answer - 1).length;
    if (!mine && others === 1) { bad++; console.log(`${path.dirname(f)} #${q.no} ✔${q.answer}「${q.options[q.answer - 1]}」 解析却引了「${q.options[hit.findIndex((h, i) => h && i !== q.answer - 1)]}」`); }
  }
}
console.log(`疑似错位 ${bad} / 查了 ${total}`);
