// 审校改了选项没改 answer；#10 #6 第二正解/理由太弱
const rep = (q, from, to, why) => { const i = q.options.indexOf(from); q.options[i] = to; delete q.distractors[from]; q.distractors[to] = why; };
module.exports = {
  6: (q) => rep(q, "がてら", "かたわら", "「かたわら」は本業の傍らで別のことを続ける意味で、挨拶のついでに説明する文脈には合わない。"),
  10: (q) => { rep(q, "ことだし", "ことなく", "「ことなく」は「〜しないで」の意味で、理由を述べる文にならない。"); rep(q, "ことでもあり", "ことなしに", "「ことなしに」は「〜せずに」の意味で、理由を述べる文にならない。"); q.doubt = null; },
  17: (q) => { q.answer = 1; q.doubt = null; },
  19: (q) => { q.answer = 1; }
};
