import { loadData,save,read,OUT,spread } from './common.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepare,config,label,run,summarize,scheduleOptions } from './simulator.mjs';
const stage=process.argv[2]??'scan';
const data=loadData(),prepared=prepare(data);
const path=resolve(OUT,'grid.json');
const out=existsSync(path)?read('grid.json'):{seeds:[1000,1001,1002,1003,1004],results:{},selected:{}};
const bases=[];
const add=(c,dimension)=>bases.push({c:config(c),dimension});
if(stage==='scan') {
 for(const schedule of Object.keys(scheduleOptions).filter(k=>k!=='P3a'))add({schedule},'schedule');
 for(const newValue of [15,10,0])add({newValue},'new');
 for(const threshold of [.65,.7,.75])for(const low of [0,5])add({newKind:'accuracy',threshold,low},'new');
 for(const fraction of [.5,.75,1])for(const low of [0,5])add({newKind:'weak',threshold:Math.floor(prepared.weak*fraction),low},'new');
 for(const leech of [8,6])for(const intake of [5,10])add({leech,intake},'leech');
 add({newValue:0,leech:8,intake:10,cap:621},'snapshot');
} else if(stage==='combine') {
 // Shortlists are chosen after the single-dimension scan; include both deployment paths.
 const schedules=['P1a','P1b'];
 const news=[{newKind:'accuracy',threshold:.65,low:5},{newKind:'weak',threshold:prepared.weak,low:5}];
 const leeches=[{leech:8,intake:5},{leech:8,intake:10}];
 out.selected.combine={schedules,news,leeches};
 for(const schedule of schedules)for(const n of news)for(const l of leeches)add({schedule,...n,...l},'combine');
 // Fixed quotas are necessary controls for a brake that may never release before the exam.
 for(const schedule of schedules)for(const newValue of [10,15])for(const l of leeches)add({schedule,newValue,...l},'fixed-control');
} else if(stage==='caps') {
 const chosen=read('shortlist.json');out.selected.caps=chosen;
 for(const base of chosen)for(const cap of [200,300])for(const selection of ['random','lowest'])add({...base,cap,selection},'caps');
} else if(stage==='actual') {
 add({},'actual');
 add({schedule:'P1a',newValue:0,leech:8,intake:5},'actual');
 for(const cap of [200,300])for(const selection of ['random','lowest'])add({schedule:'P1a',newValue:0,leech:8,intake:5,cap,selection},'actual');
 add({schedule:'P1a',newValue:0,leech:8,intake:10,cap:300},'actual');
 add({newValue:0,leech:8,intake:10,cap:621},'actual');
} else throw new Error('Expected scan, combine, caps, or actual');
let completed=0;
for(const {c:base,dimension}of bases)for(const supply of (stage==='actual'?['ordinaryN3']:['N3','N2']))for(const plateau of [false,true]) {
 const c={...base,supply,plateau},id=label(c);
 if(out.results[id]) { if(!out.results[id].dimensions.includes(dimension))out.results[id].dimensions.push(dimension);continue; }
 const runs=out.seeds.map(seed=>run(data,prepared,c,seed));
 const s=summarize(runs);
 const poolDaily=runs[0].daily.map((day,i)=>({day:day.day,pool:spread(runs.map(r=>r.daily[i].pool)),pool8:spread(runs.map(r=>r.daily[i].pool8)),backlog:spread(runs.map(r=>r.daily[i].backlog))}));
 out.results[id]={config:c,dimensions:[dimension],summary:s,seedMetrics:runs.map(r=>r.metrics),poolDaily};
 save('grid.json',out);completed++;
 console.log(JSON.stringify({id,minutes:s.middleAnswers.mid*.2,exam:s.exam_remembered.mid,n3:s.exam_n3Remembered.mid,newExam:s.newExam.mid,late:s.lateAnswers.mid*.2}));
}
save('grid.json',out);console.log(`GRID ${stage} OK: ${completed} new configurations; ${Object.keys(out.results).length} total, ${out.seeds.length} seeds each`);
