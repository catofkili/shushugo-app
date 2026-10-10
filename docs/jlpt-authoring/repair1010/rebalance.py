# 返修改题后正解位置会扎堆；每个 卷×部分 内把扎堆位置的题和最少位置交换选项，直到相差 ≤2（verify 的要求）
import json, re, sys
from collections import Counter
VOCAB = {'kanji-reading', 'orthography', 'word-formation', 'context', 'paraphrase', 'usage'}
NUMREF = re.compile(r'[①②③④]|选项\s*[1-4]|第\s*[1-4一二三四]\s*[项个]')
for lv in sys.argv[1:]:
    path = f'/Users/lsc/Documents/shushugo-wt/jlpt-sets/frontend/src/data/jlpt/n{lv}.json'
    b = json.load(open(path))
    groups = {}
    for q in b['questions']:
        groups.setdefault((q['setId'], q['kind'] in VOCAB), []).append(q)
    moved = 0
    for qs in groups.values():
        while True:
            c = Counter(q['answer'] for q in qs)
            cnt = {p: c.get(p, 0) for p in (1, 2, 3, 4)}
            hi = max(cnt, key=cnt.get); lo = min(cnt, key=cnt.get)
            if cnt[hi] - cnt[lo] <= 2: break
            cand = [q for q in reversed(qs) if q['answer'] == hi and 'order' not in q
                    and not NUMREF.search(q['explanation'] + json.dumps(q.get('distractors', {}), ensure_ascii=False))]
            q = cand[0]
            o = q['options']; o[hi-1], o[lo-1] = o[lo-1], o[hi-1]
            d = q.get('distractors', {})
            a, z = d.pop(str(hi), None), d.pop(str(lo), None)
            if a is not None: d[str(lo)] = a
            if z is not None: d[str(hi)] = z
            q['distractors'] = dict(sorted(d.items()))
            q['answer'] = lo; moved += 1
    open(path, 'w', encoding='utf8').write(json.dumps(b, ensure_ascii=False, indent=2) + '\n')
    print(f'N{lv}: 交换 {moved} 题')
