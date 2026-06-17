// 统计易混词对数量的测试脚本
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'frontend/public/nihongo.db');
const db = new sqlite3.Database(dbPath);

// 编辑距离算法
function editDistance(a, b) {
  const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function kanaSimilarity(left, right) {
  if (left === right) return 1;
  return Math.max(1 - editDistance(left, right) / Math.max(left.length, right.length, 1), 0);
}

function confusionThreshold(kana) {
  const length = kana.length;
  if (length <= 2) return 0.9;
  if (length === 3) return 0.82;
  if (length === 4) return 0.74;
  return 0.68;
}

// 统计有易混词的单词数量
db.all(`SELECT id, kana, kanji, meaning, pos, jlpt_level FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3')`, [], (err, words) => {
  if (err) {
    console.error(err);
    db.close();
    return;
  }

  let wordsWithConfusions = 0;
  let totalConfusionPairs = 0;
  const samples = [];

  words.forEach((word, index) => {
    if (index % 500 === 0) console.log(`处理进度: ${index}/${words.length}`);

    const currentKana = word.kana;
    if (!currentKana) return;

    const threshold = confusionThreshold(currentKana);
    const confusions = [];

    for (const candidate of words) {
      if (candidate.id === word.id) continue;
      if (Math.abs(currentKana.length - candidate.kana.length) > 2) continue;

      const similarity = kanaSimilarity(currentKana, candidate.kana);
      if (similarity >= threshold && similarity < 1) {
        confusions.push({
          word: candidate.kanji,
          kana: candidate.kana,
          meaning: candidate.meaning,
          similarity: similarity.toFixed(3)
        });
      }
    }

    if (confusions.length > 0) {
      wordsWithConfusions++;
      totalConfusionPairs += confusions.length;

      // 收集一些示例
      if (samples.length < 10) {
        samples.push({
          word: word.kanji,
          kana: word.kana,
          meaning: word.meaning,
          confusions: confusions.slice(0, 3)
        });
      }
    }
  });

  console.log('\n========== 统计结果 ==========');
  console.log(`N5-N3总词数: ${words.length}`);
  console.log(`有易混词的单词数: ${wordsWithConfusions}`);
  console.log(`易混词对总数: ${totalConfusionPairs}`);
  console.log(`平均每个词的易混词数: ${(totalConfusionPairs / wordsWithConfusions).toFixed(2)}`);

  console.log('\n========== 示例 ==========');
  samples.forEach(s => {
    console.log(`\n${s.word}(${s.kana}) - ${s.meaning}`);
    s.confusions.forEach(c => {
      console.log(`  → ${c.word}(${c.kana}) - ${c.meaning} [相似度: ${c.similarity}]`);
    });
  });

  db.close();
});
