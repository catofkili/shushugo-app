// #4 の説明キーが「X／X」形式 → 選択肢番号に
module.exports = { 4: (q) => {
  const map = { "であって／であって": "1", "である／である": "3", "だろう／だろう": "4" };
  q.distractors = Object.fromEntries(Object.entries(q.distractors).map(([k, v]) => [map[k] ?? k, v]));
} };
