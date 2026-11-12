import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT,INPUT,OUT,loadData,read,save,spread } from './common.mjs';
import { prepare,config,label,run,summarize } from './simulator.mjs';

export function configurations() {
  const all=[];
  for(const schedule of ['P0','P1a','P1b','P3a']) {
    const full=['P0','P1a'].includes(schedule);
    for(const gate of full?['L0','L8/10','F1','F2','F3']:['L8/10','F1'])for(const cap of full?[150,200,300,1000000]:[200,300]) {
      const code=`R${String(all.length+1).padStart(2,'0')}`;
      all.push({code,base:config({schedule,gate,cap,newValue:0,intake:10,selection:'random',supply:'ordinaryN3'})});
    }
  }
  assert.equal(all.length,48);
  return all;
}
export function fingerprints() {
  const paths=['common.mjs','gates.mjs','simulator.mjs','r2-grid.mjs'].map(f=>resolve(ROOT,'docs/audits/2026-11-12-load-policy-sim',f));
  paths.push(resolve(INPUT,'live-frozen.db'),resolve(INPUT,'fsrs-fit/params.json'));
  return Object.fromEntries(paths.map(p=>[p.startsWith(INPUT)?p.slice(INPUT.length+1):p.slice(ROOT.length+1),createHash('sha256').update(readFileSync(p)).digest('hex')]));
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const inputs=fingerprints(),reset=process.argv.includes('--reset');
  const out=!reset&&existsSync(resolve(OUT,'grid-r2.json'))?read('grid-r2.json'):{seeds:[1000,1001,1002,1003,1004],fingerprints:inputs,results:{}};
  assert.deepEqual(out.fingerprints,inputs,'Inputs or simulator changed; rerun with --reset');
  const data=loadData(),prepared=prepare(data);
  assert.equal(prepared.supply.ordinaryN3.length,0);
  for(const {code,base} of configurations())for(const plateau of [false,true]) {
    const c={...base,plateau},id=label(c);
    if(out.results[id])continue;
    const runs=out.seeds.map(seed=>run(data,prepared,c,seed));
    const summary=summarize(runs);
    const poolDaily=runs[0].daily.map((d,i)=>({day:d.day,pool:spread(runs.map(r=>r.daily[i].pool)),pool8:spread(runs.map(r=>r.daily[i].pool8))}));
    out.results[id]={code,config:c,summary,seedMetrics:runs.map(r=>r.metrics),poolDaily};
    save('grid-r2.json',out);
    console.log(JSON.stringify({code,scenario:plateau?'cap79':'main',schedule:c.schedule,gate:c.gate,cap:c.cap,minutes:summary.steadyAnswers.mid*.2,exam:summary.exam_expected.mid,day180:summary.d180_expected.mid,pool:summary.pool180.mid}));
  }
  assert.equal(Object.keys(out.results).length,96);
  console.log('ROUND 2 GRID OK: 96 configurations, 480 trajectories');
}
