"""python3 review.py N  —— 把 p_N?_official.py 应用到内存副本，打印改后的题（旧题干一行对照）和填入正解的文章全文"""
import sys,re,copy,importlib.util
from lib import *
n=int(sys.argv[1]); f=sys.argv[2] if len(sys.argv)>2 else f'p_N{n}_official.py'
s=importlib.util.spec_from_file_location('p',f); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
d=load(n); new=copy.deepcopy(d); B={q['id']:q for q in new['questions']}; old={q['id']:q for q in d['questions']}
pids=set()
for k,(why,chg) in m.P.items():
    if k.startswith('PASSAGE:'): new['passages'][k[8:]]=chg; pids.add(k[8:]); continue
    q=B[bank_id(k)]
    for fld,v in chg.items():
        if fld=='distractors':
            q['distractors'].update({str(a):b for a,b in v.items()})
            for a in [a for a,b in v.items() if b is None]: q['distractors'].pop(str(a))
        else: q[fld]=v
    if q['kind']=='passage': pids.add(q['passageId'])
for k,(why,chg) in m.P.items():
    if k.startswith('PASSAGE:'): continue
    q=B[bank_id(k)]; o=old[q['id']]
    print(f'>>> {why}')
    if o['stem']!=q['stem'] and q['kind']!='passage': print('   旧:',o['stem'],'|',' / '.join(o['options']))
    print(render(q,new)); print()
for pid in sorted(pids):
    qs={q['stem']:q for q in new['questions'] if q.get('passageId')==pid}
    print('### 填正解',pid); print(re.sub(r'\[(\d+)\]',lambda mm:'【'+qs[f'[{mm.group(1)}]']['options'][qs[f'[{mm.group(1)}]']['answer']-1]+'】',new['passages'][pid])); print()
