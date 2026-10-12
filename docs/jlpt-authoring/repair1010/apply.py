"""python3 apply.py p_N5.py [--write]
补丁文件定义 P = {census_id: (原因, {字段: 新值})}，另可用 'PASSAGE:<passageId>': (原因, 新文章)。
默认只演示（打印改前/改后），--write 才写进题库。校验不过一律不写。"""
import sys,re,copy,importlib.util,json
from lib import *
NUM={'一':1,'二':2,'三':3,'四':4,'1':1,'2':2,'3':3,'4':4,'１':1,'２':2,'３':3,'４':4}
def posref(q):
    """解析里的 第N句 / [a,b,c,d] 跟打乱后的 answer / order 对不上就返回描述（与 ../posref.py 同口径，但只判错的）。"""
    t=q['explanation']+''.join(q['distractors'].values()); out=[]
    for m in re.finditer(r'第([一二三四1-4１-４])[句项]',t):
        if q['kind']=='usage' and NUM[m.group(1)]!=q['answer'] and q['explanation'].count('第')==1 and m.group(0) in q['explanation'] and '正确' in q['explanation']+'正确': out.append(m.group(0))
    for m in re.finditer(r'[\[［]\s*(\d)\s*[,，、]\s*(\d)\s*[,，、]\s*(\d)\s*[,，、]\s*(\d)\s*[\]］]',t):
        if q.get('order')!=[int(x) for x in m.groups()]: out.append(m.group(0))
    return out

def check(q,d):
    e=[]
    o=q['options']
    if len(o)!=4 or len(set(o))!=4: e.append('选项不是 4 个互异项')
    if q['answer'] not in (1,2,3,4): e.append('answer 越界')
    if set(q['distractors'])!={str(i) for i in range(1,5) if i!=q['answer']}: e.append('distractors 键不对')
    if any(not str(v).strip() for v in q['distractors'].values()): e.append('distractors 有空串')
    if posref(q): e.append('解析里的编号与现在的顺序对不上: '+' '.join(posref(q)))
    k=q['kind']
    if k=='sentence-order':
        od=q.get('order')
        if sorted(od or [])!=[1,2,3,4]: e.append('order 不是 1-4 的排列')
        else:
            parts=q['stem'].split('★')
            blanks_before=parts[0].count('＿＿')
            if len(parts)!=2 or q['stem'].count('＿＿')!=3: e.append('题干应有 3 个 ＿＿ 和一个 ★')
            else:
                # ★ 是第几个空：★ 自己占一个空位
                pos=blanks_before  # 0-based 位置
                if od[pos]!=q['answer']: e.append(f'★ 位置 {pos+1} 上的选项是 {od[pos]}，answer={q["answer"]}')
    elif k in ('kanji-reading','orthography','paraphrase'):
        if '[[' not in q['stem']: e.append('缺 [[ ]] 标记')
    elif k in ('context','grammar-form'):
        if '（' not in q['stem']: e.append('题干没有空')
    elif k=='passage':
        m=re.fullmatch(r'\[(\d+)\]',q['stem'])
        if not m: e.append('passage 题干格式')
        elif f'[{m.group(1)}]' not in d['passages'][q['passageId']]: e.append('文章里没有这个空号')
    return e

def main():
    pf=sys.argv[1]; write='--write' in sys.argv
    lvl=int(re.search(r'N(\d)',pf).group(1))
    spec=importlib.util.spec_from_file_location('p',pf); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    d=load(lvl); new=copy.deepcopy(d); byid={q['id']:q for q in new['questions']}
    errs=[]
    for key,(why,chg) in m.P.items():
        if key.startswith('PASSAGE:'):
            pid=key[8:]
            print(f'=== {pid}  ({why})\n--- 旧\n{d["passages"][pid]}\n+++ 新\n{chg}\n')
            new['passages'][pid]=chg; continue
        q=byid[bank_id(key)]; old=copy.deepcopy(q)
        for f,v in chg.items():
            if f=='distractors' and isinstance(v,dict):
                q['distractors'].update({str(a):b for a,b in v.items()})
                for a in [a for a,b in v.items() if b is None]: q['distractors'].pop(str(a))
            else: q[f]=v
        print(f'=== {key}  ({why})')
        for f in chg:
            if old.get(f)!=q.get(f): print(f'  [{f}]\n    - {old.get(f)}\n    + {q.get(f)}')
        for x in check(q,new): errs.append(f'{key}: {x}')
    # 文章改了：对该文章的所有题再校验一遍空号
    for q in new['questions']:
        if q['kind']=='passage':
            for x in check(q,new): errs.append(f'{cen_id(q["id"])}: {x}')
    if errs:
        print('\n校验失败，未写盘:'); [print(' ',x) for x in sorted(set(errs))]; sys.exit(1)
    if write: save(lvl,new); print(f'\n已写入 n{lvl}.json')
    else: print('\n(演示，未写盘；加 --write 写入)')
main()
