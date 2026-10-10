import json,re,sys,os
BANK='/Users/lsc/Documents/shushugo-wt/jlpt-sets/frontend/src/data/jlpt'
CEN='/Users/lsc/Documents/shushugo-wt/_codex/jlpt-census'
def bank_id(cid):  # s1-N4-v-01 -> n4-v-trial1-01
    s,l,t,n=cid.split('-'); return f'{l.lower()}-{t}-trial{s[1:]}-{n}'
def cen_id(bid):
    l,t,s,n=bid.split('-'); return f's{s[5:]}-{l.upper()}-{t}-{n}'
def load(n): return json.load(open(f'{BANK}/n{n}.json',encoding='utf8'))
def save(n,d):
    open(f'{BANK}/n{n}.json','w',encoding='utf8').write(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def findings(n):
    out={}
    for x in json.load(open(f'{CEN}/out/N{n}/findings.json')):
        out.setdefault(x['id'],[]).append(x)
    return out
def render(q,d=None,ids=True):
    L=[f"## {cen_id(q['id'])}  [{q['kind']}]  target={(q.get('target') or {}).get('surface')}"]
    if q['kind']=='passage' and d:
        L.append(f"(文章 {q['passageId']})")
    L.append('stem: '+q['stem'])
    for i,o in enumerate(q['options'],1):
        mark='✔' if i==q['answer'] else ' '
        ds=q['distractors'].get(str(i),'')
        L.append(f" {mark}{i} {o}"+(f"   ← {ds}" if ds else ''))
    L.append('解析: '+q['explanation'])
    if 'order' in q: L.append(f"order: {q['order']}")
    return '\n'.join(L)
