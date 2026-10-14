// #10 選択肢の途中に全角スペースが入っている
module.exports = { 10: (q) => { q.options[2] = q.options[2].replace("　", ""); } };
