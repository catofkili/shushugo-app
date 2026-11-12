import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT,INPUT,OUT,START,EXAM,read,save,loadData,selfCheck } from './common.mjs';
import { prepare,run } from './simulator.mjs';
import { configurations,fingerprints } from './r2-grid.mjs';
import './r2-check.mjs';
const dir=resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim');
const reportPath=resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim-r2.md');
const firstReport=resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim.md');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const git=args=>{const r=spawnSync('git',args,{cwd:ROOT,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
assert.equal(readFileSync(firstReport,'utf8'),git(['show','HEAD:docs/audits/2026-11-12-load-policy-sim.md']),'First report changed');
const grid=read('grid-r2.json'),cal=read('calibration-r2.json'),all=Object.values(grid.results);
assert.deepEqual(grid.fingerprints,fingerprints(),'Inputs changed since simulation');
assert.equal(hash(resolve(INPUT,'live-frozen.db')),read('preflight.json').sha256);
assert.equal(all.length,96);assert.deepEqual(grid.seeds,[1000,1001,1002,1003,1004]);
const expected=configurations();
assert.equal(new Set(all.map(r=>r.code)).size,48);
for(const {code,base} of expected)for(const plateau of [false,true]) {
  const matches=all.filter(r=>r.code===code&&r.config.plateau===plateau);
  assert.equal(matches.length,1,code);assert.deepEqual(matches[0].config,{...base,plateau});
}
for(const [schedule,n] of [['P0',40],['P1a',40],['P1b',8],['P3a',8]])assert.equal(all.filter(r=>r.config.schedule===schedule).length,n);
selfCheck();
const data=loadData(),prepared=prepare(data);
assert.equal(prepared.supply.ordinaryN3.length,0);
for(const live of Object.values(prepared.starts)) {
  assert.equal(live.length,3869);
  for(let i=0;i<live.length;i++)assert.deepEqual(live[i].mt,prepared.starts.P0[i].mt);
}
for(const r of all) {
  assert.equal(r.seedMetrics.length,5);assert.equal(r.poolDaily.length,180);
  for(const m of r.seedMetrics) {
    assert.equal(m.newTotal,0);assert.equal(m.newExam,0);assert(m.first<=r.config.cap);
    assert(Math.abs(m.answers*180-m.totalAnswers)<1e-7);
    assert(Math.abs(m.earlyAnswers*14+m.steadyAnswers*166-m.totalAnswers)<1e-7);
    for(const prefix of ['early','middle','late'])assert(m[`${prefix}Peak`]>=m[`${prefix}Answers`]&&m.peak>=m[`${prefix}Peak`]);
    for(const when of ['exam','d60','d180']) {
      assert.equal(m[`${when}_total`],3869);
      assert(Math.abs(m[`${when}_expected`]-3869*m[`${when}_meanR`])<1e-7);
      assert(m[`${when}_expected`]>=0&&m[`${when}_expected`]<=3869);
      assert(m[`${when}_remembered`]>=0&&m[`${when}_remembered`]<=3869);
      if(r.config.plateau){assert.equal(m[`${when}_remembered`],0);assert(m[`${when}_meanR`]<=.79+1e-10);}
    }
    if(['L0','F3'].includes(r.config.gate))assert.equal(m.pool180,0);
    assert(m.pool180>=0&&m.pool180<=3488);
  }
  for(let i=0;i<180;i++) {
    assert.equal(r.poolDaily[i].day,START+i);
    if(i&&r.config.gate==='L8/10')assert(r.poolDaily[i].pool.mid>=r.poolDaily[i-1].pool.mid);
  }
}
for(const [code,plateau] of [['R02',false],['R26',true],['R30',false],['R33',true],['R38',false],['R39',true],['R43',false],['R48',true]]) {
  const r=all.find(x=>x.code===code&&x.config.plateau===plateau),again=run(data,prepared,r.config,grid.seeds[0]);
  assert.deepEqual(again.metrics,r.seedMetrics[0],`Not reproducible: ${code}`);
  assert(again.daily.every(d=>d.first<=r.config.cap&&d.answers>=d.first));
  assert.equal(again.daily.find(d=>d.day===EXAM).knowledge.total,3869);
}
assert.equal(cal.round,4);
assert.equal(cal.pass,Object.values(cal.errors).every(x=>Math.abs(x)<=.15));
for(const [k,target] of Object.entries({first:387,answers:847,forgot:.39}))assert(Math.abs(cal.summary[k].mid/target-1-cal.errors[k])<1e-12);
const report=readFileSync(reportPath,'utf8');
assert.equal(report,readFileSync(resolve(OUT,'report-r2.md'),'utf8'));
for(const h of ['四个问题','等时间对比','全部组合','建议','局限'])assert(report.includes(`\n## ${h}\n`));
const questions=report.split('## 四个问题\n')[1].split('## 等时间对比')[0].split('\n').filter(l=>/^[1-4]\. /.test(l));
assert.equal(questions.length,4);assert(report.includes('不值得重算'));assert(report.includes('未完成独立标定'));
const cells=section=>section.split('\n').filter(l=>/^\| (?:主场景|封顶79%|R\d\d)/.test(l)).map(l=>l.split('|').slice(1,-1).map(s=>s.trim()));
const minute=r=>r.summary.steadyAnswers.mid*.2;
const bucket=r=>[45,70,100,140].findIndex(v=>minute(r)<=v)===-1?4:[45,70,100,140].findIndex(v=>minute(r)<=v);
const sorted=(p,b,key)=>all.filter(r=>r.config.plateau===p&&bucket(r)===b).sort((a,z)=>z.summary[key].mid-a.summary[key].mid||a.code.localeCompare(z.code));
const positions=(r,key)=>sorted(r.config.plateau,bucket(r),key).findIndex(x=>x.code===r.code)+1;
for(const [number,key,next] of [[1,'d180_expected',2],[2,'exam_expected',3]]) {
  const section=report.split(`### 表${number}：`)[1].split(`### 表${next}：`)[0],published=cells(section),wanted=[];
  for(const p of [false,true])for(let b=0;b<5;b++)for(const [i,r] of sorted(p,b,key).slice(0,5).entries())wanted.push([r,i+1]);
  assert.equal(published.length,wanted.length);
  for(let i=0;i<wanted.length;i++) {
    const [r,pos]=wanted[i],row=published[i];
    assert.equal(row[0],r.config.plateau?'封顶79%':'主场景');assert.equal(Number(row[2]),pos);assert(row[3].startsWith(r.code+' '));
    assert(Math.abs(parseFloat(row[4])-minute(r))<=.051);
    assert(Math.abs(parseFloat(row[7])-r.summary.exam_expected.mid)<=.051);
    assert(Math.abs(parseFloat(row[8])-r.summary.d180_expected.mid)<=.051);
  }
}
const mismatches=all.filter(r=>!r.config.plateau).filter(r=>{const z=all.find(v=>v.code===r.code&&v.config.plateau);return bucket(r)!==bucket(z)||['d180_expected','exam_expected'].some(k=>positions(r,k)!==positions(z,k));}).map(r=>r.code).sort();
const publishedMismatch=cells(report.split('### 表3：')[1].split('### 接近等时')[0]).map(row=>row[0].slice(0,3)).sort();
assert.deepEqual(publishedMismatch,mismatches);
const full=cells(report.split('## 全部组合\n')[1].split('## 建议')[0]);
assert.equal(full.length,192);
for(const {code} of expected)assert.equal(full.filter(row=>row[0]===code||row[0].startsWith(code+' ')).length,4);
const files=[firstReport,reportPath,...readdirSync(dir).map(f=>resolve(dir,f))];
for(const file of files) {
  assert(!/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(readFileSync(file,'utf8')),`Kana: ${file}`);
  if(file.endsWith('.mjs')) {
    const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  }
}
const status=git(['status','--short','--untracked-files=all']).trimEnd().split('\n').filter(Boolean);
for(const line of status)assert(line.slice(3).startsWith('docs/audits/2026-11-12-load-policy-sim'),`Unexpected change: ${line}`);
const manifest={passed:true,configurations:96,trajectories:480,seeds:5,calibration:cal.status,rankingMismatches:mismatches.length,
  checks:['forgiveness and reentry transitions','recent-ten window and pool intake','F3 priority under insufficient caps','96 configurations and 480 metric sets','identical truth starts, fixed inventory, timing and knowledge identities','eight deterministic reruns with daily caps','published top-five rankings, scenario disagreements, full-grid coverage','five required headings, privacy, original report unchanged, source syntax, Git scope'],
  fingerprints:grid.fingerprints,publicFiles:Object.fromEntries(files.map(f=>[relative(ROOT,f),hash(f)])),gitStatus:status};
save('verification-r2.json',manifest);
console.log(JSON.stringify({passed:true,configurations:96,trajectories:480,rankingMismatches:mismatches.length,calibration:cal.status,files:files.length,changes:status.length}));
