#!/usr/bin/env python3
"""
将新格式的grammar.ts转换为项目期望的格式
"""
import json
import re

# 读取新格式的数据
with open('src/data/grammar.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取数组部分
match = re.search(r'export const GRAMMAR_POINTS: GrammarPoint\[\] = (\[[\s\S]+\]);', content)
if not match:
    print("无法找到数据")
    exit(1)

data_str = match.group(1)
# 将JavaScript对象转换为有效的JSON
# 移除尾部逗号
data_str = re.sub(r',(\s*[}\]])', r'\1', data_str)
data = json.loads(data_str)

print(f"找到 {len(data)} 个语法点")

# 转换格式
converted = []
for item in data:
    # 转换examples
    examples = []
    for ex in item.get('examples', []):
        example = {
            'japanese': ex.get('jp', ''),
            'reading': ex.get('reading', ''),
            'chinese': ex.get('cn', ''),
            'notes': []
        }
        # 从breakdown提取notes
        for breakdown_item in ex.get('breakdown', []):
            if 'word' in breakdown_item and 'note' in breakdown_item:
                example['notes'].append({
                    'text': breakdown_item['word'],
                    'note': breakdown_item['note']
                })
        examples.append(example)

    # 转换quizzes
    quizzes = []
    for quiz in item.get('quiz', []):
        quiz_obj = {
            'id': f"{item['id']}-q{len(quizzes)+1}",
            'type': 'choice' if quiz.get('type') == 'choice' else ('boolean' if quiz.get('type') == 'truefalse' else 'input'),
            'prompt': quiz.get('question', ''),
            'explanation': quiz.get('explanation', '')
        }

        if quiz.get('type') == 'choice':
            quiz_obj['options'] = quiz.get('options', [])
            answer_idx = quiz.get('answer', 0)
            if isinstance(answer_idx, int) and answer_idx < len(quiz_obj['options']):
                quiz_obj['answer'] = quiz_obj['options'][answer_idx]
            else:
                quiz_obj['answer'] = quiz_obj['options'][0] if quiz_obj['options'] else ''
        elif quiz.get('type') == 'truefalse':
            quiz_obj['answer'] = quiz.get('answer', True)
        else:
            quiz_obj['answer'] = quiz.get('answer', '')

        quizzes.append(quiz_obj)

    # 创建转换后的对象
    converted_item = {
        'id': item['id'],
        'title': item['title'],
        'level': item['level'],
        'meaning': item['meaning'],
        'structure': item['structure'],
        'explanation': item['explanation'],
        'examples': examples,
        'comparisons': item.get('comparisons', []),
        'quizzes': quizzes
    }
    converted.append(converted_item)

# 生成新的TypeScript文件
output = '''import { GrammarPoint } from "../types/grammar";

export const grammarPoints: GrammarPoint[] = '''

output += json.dumps(converted, ensure_ascii=False, indent=2)
output += ';\n'

# 写入文件
with open('src/data/grammar.ts', 'w', encoding='utf-8') as f:
    f.write(output)

print(f"转换完成！已生成 {len(converted)} 个语法点")
