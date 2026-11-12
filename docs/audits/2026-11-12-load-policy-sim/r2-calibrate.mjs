import { loadData,read,save } from './common.mjs';
import { prepare,config,run,summarize } from './simulator.mjs';
const data=loadData(),prepared=prepare(data);
// Round 3 applied a 515-review ceiling as though every historical day actually planned 515 reviews.
// Read the day's planned review count before applying the already-used participation fraction; new quota remains 25.
const runs=[1000,1001,1002,1003,1004].map(seed=>run(data,prepared,config(),seed,{round:4}));
const summary=summarize(runs),target={first:387,answers:847,forgot:.39};
const errors=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,summary[k].mid/v-1]));
const pass=Object.values(errors).every(e=>Math.abs(e)<=.15);
const status=pass?'CALIBRATION OK (historical window only)':'CALIBRATION FAIL';
const result={round:4,status,pass,summary,errors,previous:read('calibration.json').status,rule:'min(515, planned review tasks) times historical participation; 25 fresh cards'};
save('calibration-r2.json',result);
console.log(JSON.stringify({round:4,status,first:summary.first,answers:summary.answers,forgot:summary.forgot,errors}));
