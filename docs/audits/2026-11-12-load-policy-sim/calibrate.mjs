import { loadData,save } from './common.mjs';
import { prepare,config,run,summarize } from './simulator.mjs';
const data=loadData(),p=prepare(data),rounds=[];
for(let round=1;round<=3;round++) {
 const runs=Array.from({length:5},(_,i)=>run(data,p,config(),1000+i,{round}));
 const s=summarize(runs),target={first:387,answers:847,forgot:.39};
 const errors=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,(s[k].mid/v-1)]));
 const pass=Object.values(errors).every(e=>Math.abs(e)<=.15);
 const row={round,summary:s,errors,pass};rounds.push(row);
 console.log(JSON.stringify({round,first:s.first,answers:s.answers,forgot:s.forgot,errors,pass}));
 if(pass)break;
}
const last=rounds.at(-1),status=last.pass?'CALIBRATION OK':'CALIBRATION FAIL '+Object.entries(last.errors).filter(([,e])=>Math.abs(e)>.15).map(([k,e])=>`${k} ${(e*100).toFixed(1)}%`).join('; ');
save('calibration.json',{status,rounds,pools:Object.fromEntries(Object.entries(data.pools).map(([k,v])=>[k,v.length])),weak:p.weak,supply:Object.fromEntries(Object.entries(p.supply).map(([k,v])=>[k,v.length])),secondsPerAnswer:data.secondsPerAnswer,matchedTime:data.matchedTime});
console.log(status);
