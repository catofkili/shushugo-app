#!/usr/bin/env node
import fs from 'fs';

// 读取原始文件
const content = fs.readFileSync('src/data/grammar.ts', 'utf-8');

// 提取GRAMMAR_POINTS数组 - 匹配到第一个 ];
const match = content.match(/export const GRAMMAR_POINTS: GrammarPoint\[\] = (\[[\s\S]+?\n\]);/);
if (!match) {
  console.error('无法找到GRAMMAR_POINTS数组');
  process.exit(1);
}

// 使用Function提取数据
const extractData = new Function(`return ${match[1]}`);

const data = extractData();
console.log(`找到 ${data.length} 个语法点`);

// 转换格式
const converted = data.map((item, index) => {
  // 转换examples
  const examples = (item.examples || []).map(ex => ({
    japanese: ex.jp || '',
    reading: ex.reading || '',
    chinese: ex.cn || '',
    notes: (ex.breakdown || []).map(b => ({
      text: b.word || '',
      note: b.note || ''
    }))
  }));

  // 转换quizzes
  const quizzes = (item.quiz || []).map((quiz, qIndex) => {
    const quizObj = {
      id: `${item.id}-q${qIndex + 1}`,
      type: quiz.type === 'truefalse' ? 'boolean' : (quiz.type || 'choice'),
      prompt: quiz.question || '',
      explanation: quiz.explanation || ''
    };

    if (quiz.type === 'choice') {
      quizObj.options = quiz.options || [];
      const answerIdx = quiz.answer;
      if (typeof answerIdx === 'number' && answerIdx < quizObj.options.length) {
        quizObj.answer = quizObj.options[answerIdx];
      } else {
        quizObj.answer = quizObj.options[0] || '';
      }
    } else if (quiz.type === 'truefalse') {
      quizObj.answer = quiz.answer === true || quiz.answer === 'true';
    } else {
      quizObj.answer = quiz.answer || '';
    }

    return quizObj;
  });

  return {
    id: item.id,
    title: item.title,
    level: item.level,
    meaning: item.meaning,
    structure: item.structure,
    explanation: item.explanation,
    examples: examples,
    comparisons: item.comparisons || [],
    quizzes: quizzes
  };
});

// 生成新的TypeScript文件
const output = `import { GrammarPoint } from "../types/grammar";

export const grammarPoints: GrammarPoint[] = ${JSON.stringify(converted, null, 2)};
`;

// 写入文件
fs.writeFileSync('src/data/grammar.ts', output, 'utf-8');
console.log(`转换完成！已生成 ${converted.length} 个语法点`);
