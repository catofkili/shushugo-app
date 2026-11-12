import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT,INPUT,OUT,read,save,loadData,selfCheck } from './common.mjs';
import { prepare,run } from './simulator.mjs';
const dir=resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim');
const reportPath=resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim.md');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pre=read('preflight.json'),grid=read('grid.json'),cal=read('calibration.json'),diag=read('diagnosis.json');
assert.equal(hash(resolve(INPUT,'live-frozen.db')),pre.sha256,'Frozen database changed');
assert.equal(Object.keys(grid.results).length,228);
assert.deepEqual(grid.seeds,[1000,1001,1002,1003,1004]);
assert.equal(cal.rounds.length,3);assert(cal.status.startsWith('CALIBRATION FAIL'));
assert.equal(diag.observed.newWords,603);assert.equal(diag.observed.priorFirstReal,101);assert.equal(diag.observed.firstPerDay,387);assert.equal(diag.observed.answers,23742);assert.equal(diag.observed.n,10132);
selfCheck();
const data=loadData(),p=prepare(data);
assert.equal(data.pools.fresh.length,603);assert.equal(p.starts.P0.length,3869);assert.equal(p.supply.N3.length,157);assert.equal(p.supply.N2.length,3635);assert.equal(p.supply.ordinaryN3.length,0);
for(const v of Object.values(p.starts)) {
 assert.equal(v.length,p.starts.P0.length);
 for(let i=0;i<v.length;i++) { assert.deepEqual(v[i].mt,p.starts.P0[i].mt);assert.equal(v[i].retired,p.starts.P0[i].retired); }
}
for(const [id,r] of Object.entries(grid.results)) {
 assert.equal(r.seedMetrics.length,5,id);
 assert.equal(r.poolDaily.length,180,id);
 const available=p.supply[r.config.supply].length;
 for(const m of r.seedMetrics) {
   assert(m.newTotal<=available&&m.newExam<=m.newTotal,id);
   assert(m.first<=r.config.cap+1e-8,id);
   assert(m.exam_remembered<=m.exam_total,id);
   for(const when of ['exam','d60','d180']) {
     assert(m[`${when}_meanR`]>=0&&m[`${when}_meanR`]<=1,id);
     assert(m[`${when}_expected`]>=0&&m[`${when}_expected`]<=m[`${when}_total`],id);
     if(r.config.plateau){assert.equal(m[`${when}_remembered`],0,id);assert(m[`${when}_meanR`]<=.790001,id);}
   }
 }
 for(let i=1;i<180;i++) assert(r.poolDaily[i].pool.mid>=r.poolDaily[i-1].pool.mid,id);
}
const probes=['P0_F25_L0_all_N3_main','P1a_F0_L8K5_C300-random_ordinaryN3_main','P1a_accuracy0.65-5_L8K5_C300-random_N3_cap79','P1a_accuracy0.65-5_L8K5_C300-lowest_N2_main'];
for(const id of probes) {
 const r=grid.results[id],again=run(data,p,r.config,grid.seeds[0]);
 assert.deepEqual(Object.fromEntries(Object.keys(r.seedMetrics[0]).map(k=>[k,again.metrics[k]])),r.seedMetrics[0],`Non-reproducible trajectory ${id}`);
 assert(again.daily.every(d=>d.first<=r.config.cap),id);
 assert(again.daily.every(d=>d.answers>=d.first),id);
}
const report=readFileSync(reportPath,'utf8');
assert.equal(report,readFileSync(resolve(OUT,'report.md'),'utf8'));
for(const h of ['结论','标定','方案对比','诊断','建议的参数','局限'])assert(report.includes(`\n## ${h}\n`),h);
assert(report.includes(cal.status));
const conclusion=report.slice(report.indexOf('## 结论'),report.indexOf('## 标定')).trimEnd();
assert(conclusion.split('\n').length<=12,`Conclusion length ${conclusion.split('\n').length}`);
const files=[reportPath,...readdirSync(dir).map(f=>resolve(dir,f))];
for(const path of files) {
 assert(/\.(mjs|py|md)$/.test(path),path);
 assert(!/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(readFileSync(path,'utf8')),`Kana privacy gate: ${path}`);
}
const status=spawnSync('git',['status','--short','--untracked-files=all'],{cwd:ROOT,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8'});
assert.equal(status.status,0,status.stderr);
const changed=status.stdout.trimEnd().split('\n').filter(Boolean);
for(const line of changed) {
 const path=line.slice(3);
 assert(path==='docs/audits/2026-11-12-load-policy-sim.md'||path==='docs/audits/2026-11-12-load-policy-sim-r2.md'||path.startsWith('docs/audits/2026-11-12-load-policy-sim/'),`Unexpected change: ${line}`);
}
const manifest={passed:true,configurations:228,seeds:5,forecastRuns:1140,calibration:cal.status,conclusionLines:conclusion.split('\n').length,databaseSha256:pre.sha256,
 checks:['600 official scheduling equivalence cases','fitted truth identical across deployment modes','all 228 configurations and five seeds','inventory, first-word caps, plateau knowledge, pool monotonicity','four deterministic trajectory reruns','six report sections, calibration label, conclusion length','no kana and no extra public file changes'],
 publicFiles:Object.fromEntries(files.map(f=>[relative(ROOT,f),hash(f)])),
 inputs:Object.fromEntries(['fsrs-fit/load.mjs','fsrs-fit/params.json','fsrs-fit/fit.json','fsrs-fit/cards.json'].map(f=>[f,hash(resolve(INPUT,f))])),gitStatus:changed};
save('verification.json',manifest);
console.log(JSON.stringify({passed:true,configurations:228,runs:1140,calibration:cal.status,conclusionLines:manifest.conclusionLines,publicFiles:files.length,changed}));
