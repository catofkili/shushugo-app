import sys
from lib import *
# usage: dump.py N [sets=123] [sev=ABC]   -> flagged questions of banked sets with findings
n=int(sys.argv[1]); sets=sys.argv[2] if len(sys.argv)>2 else '123'; sev=sys.argv[3] if len(sys.argv)>3 else 'ABC'
d=load(n); F=findings(n); byid={q['id']:q for q in d['questions']}
shown=set()
for cid,fs in sorted(F.items()):
    if cid.split('-')[0][1:] not in list(sets): continue
    fs=[f for f in fs if f['severity'] in sev]
    if not fs: continue
    q=byid.get(bank_id(cid))
    if not q: print('!! missing',cid); continue
    if q['kind']=='passage' and q['passageId'] not in shown:
        shown.add(q['passageId']); print('### PASSAGE',q['passageId'],'\n'+d['passages'][q['passageId']],'\n')
    print(render(q,d))
    for f in fs: print(f" [{f['severity']}/{f['category']}] {f['problem']}\n   fix: {f['fix']}")
    print()
