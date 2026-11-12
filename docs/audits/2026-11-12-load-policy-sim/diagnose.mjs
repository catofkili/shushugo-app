import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { ROOT,OUT,loadData,rows,db,save,dayNum,median,mean } from './common.mjs';
const data=loadData(),FROM=dayNum('2026-10-01'),TO=dayNum('2026-11-02');
const inWindow=d=>d>=FROM&&d<=TO;
// Execute the real grouping code with a read-only database adapter, without importing application startup.
const appRequire=createRequire(resolve(ROOT,'frontend/package.json'));
const {build}=appRequire('esbuild');
const bundle=await build({entryPoints:[resolve(ROOT,'frontend/src/lib/confusion-groups.ts')],bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'read-only-analysis',setup(b){
  b.onResolve({filter:/^(\.\/database(?:\/db-utils)?|\.\/study-core|\.\/perf-marks|lucide-react)$/},a=>({path:a.path,namespace:'readonly'}));
  b.onLoad({filter:/.*/,namespace:'readonly'},a=>{
   if(a.path.endsWith('db-utils'))return {contents:`export const rowsFor=(q,a=[])=>globalThis.__loadPolicyDb.prepare(q).all(...a);export const firstValue=(q,a=[],fallback=null)=>{const r=rowsFor(q,a)[0];return r?Object.values(r)[0]:fallback};`};
   if(a.path==='./database')return {contents:'export const getDatabase=()=>globalThis.__loadPolicyDb;'};
   if(a.path==='./study-core')return {contents:'export const ensureUserTables=()=>{};export const persistSoon=()=>{throw new Error("writes prohibited")};'};
   if(a.path==='./perf-marks')return {contents:'export const perfTime=(label,f)=>f();'};
   return {contents:'export const ArrowLeftRight=null,Crown=null,Handshake=null,PenLine=null,Sprout=null,Type=null,Volume2=null;'};
  });
 }}]});
const modulePath=resolve(OUT,'confusion-readonly.mjs');writeFileSync(modulePath,bundle.outputFiles[0].text);
globalThis.__loadPolicyDb=db;
const {confusionGroups,displayForm}=await import(pathToFileURL(modulePath).href);
const groups=confusionGroups(),members=new Set(groups.flatMap(g=>g.members.map(m=>m.id)));
const kanjiRows=new Map(rows('SELECT id,kanji,kana,pos,collocation_tier FROM words').map(x=>[x.id,x]));
const clean=s=>s.replace(/\[[^\]]*\]/g,'').replace(/\s+/g,'');
const cjk=/[\u3400-\u9fff\uf900-\ufaff]/gu;
const pure=/^[\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fd-\u30ff\u30fc]+$/u;
// Raw POS labels are never exported: normalize them to Chinese-only categories.
const posLabel=s=>s.includes('固定搭配')||s.includes('惯用')||s.includes('成句')||s.includes('\u9023\u8a9e')?'固定搭配或短语':s.includes('副')?'副词':s.includes('形')?'形容词':s.includes('动')||s.includes('词短语')?'动词':s.includes('名')?'名词':s.startsWith('代')?'代词':s.startsWith('接')?'接续或词缀':s.includes('助')?'助词':s.includes('感')?'感叹词':'其他';
const features=w=>{
 const row=kanjiRows.get(w.id),surface=clean(displayForm(row)),n=[...surface.matchAll(cjk)].length;
 return {level:w.level,pos:posLabel(row.pos),kana:pure.test(surface)?'纯假名':'其他表记',hanzi:n===0?'0个':n===1?'1个':n===2?'2个':'3个以上',confusion:members.has(w.id)?'在辨析组':'不在辨析组',collocation:row.collocation_tier!==null?'固定搭配':'普通词'};
};
const attrs=new Map(data.words.map(w=>[w.id,features(w)]));
const totalSample={n:0,ok:0,forgot:0,fuzzy:0};
const sample=()=>({n:0,ok:0,forgot:0,fuzzy:0});
const add=(bucket,key,g)=>{if(!bucket[key])bucket[key]=sample();const s=bucket[key];s.n++;s.ok+=g>=3;s.forgot+=g===1;s.fuzzy+=g===2;};
const newSuccess={},newGap={},relearnGap={},chains={},byAttr={},position={},weekday={},overallGap={};
const gapBin=n=>n===1?'1天':n<=3?'2至3天':n<=7?'4至7天':n<=21?'8至21天':'22天以上';
for(const kind of Object.keys(attrs.values().next().value))byAttr[kind]={};
const allEvents=[...data.histories.values()].flat().filter(r=>inWindow(r.day)).sort((a,b)=>a.at-b.at||a.eventId-b.eventId);
const positionOf=new Map();let previousDay=-1,ordinal=0;
for(const r of allEvents){if(r.day!==previousDay){ordinal=0;previousDay=r.day;}ordinal++;positionOf.set(r.eventId,ordinal);}
let newNoReturn=0,relearnNoReturn=0,relearnUnfinished=0;
const newDetails={firstKnow:sample(),firstForgot:sample(),firstHard:sample()};
const exactPos={};
const chainLengths=[];let chainCensored=0;
for(const [id,ss]of data.sessions) {
 const fresh=ss[0];
 if(inWindow(fresh.day)&&!data.prior.has(id)) {
   const second=ss[1];
   if(second){const correct=fresh.seq.filter(x=>x.g>=3).length;add(newSuccess,correct===0?'0次':correct===1?'1次':correct===2?'2次':'3次以上',second.seq[0].g);add(newGap,gapBin(second.day-fresh.day),second.seq[0].g);
    const target=fresh.seq[0].g>=3?newDetails.firstKnow:fresh.seq[0].g===1?newDetails.firstForgot:newDetails.firstHard;
    target.n++;target.ok+=second.seq[0].g>=3;target.forgot+=second.seq[0].g===1;
   }else newNoReturn++;
 }
 let length=0,hasWindow=false;
 const flush=(censored=false)=>{if(length&&hasWindow){const key=length<4?String(length):length<7?'4至6':length<10?'7至9':'10以上';chains[key]=(chains[key]??0)+1;chainLengths.push(length);chainCensored+=censored;}length=0;hasWindow=false;};
 for(let i=1;i<ss.length;i++) {
   const s=ss[i],g=s.seq[0].g,prev=ss[i-1],lastForgot=s.seq.findLastIndex(x=>x.g===1);
   if(inWindow(s.day)) {
     totalSample.n++;totalSample.ok+=g>=3;totalSample.forgot+=g===1;totalSample.fuzzy+=g===2;
     add(overallGap,gapBin(s.day-prev.day),g);
     for(const [k,v]of Object.entries(attrs.get(id)))add(byAttr[k],v,g);
     const n=positionOf.get(s.seq[0].eventId);add(position,n<=100?'第1至100次':n<=300?'第101至300次':'第301次以后',g);
     add(weekday,['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date(s.day*86400000).getUTCDay()],g);
     const raw=kanjiRows.get(id).pos;
     // Preserve a distinct raw-POS cell as a numbered category, not a content label.
     if(!exactPos[raw])exactPos[raw]={...sample(),category:posLabel(raw)};
     exactPos[raw].n++;exactPos[raw].ok+=g>=3;exactPos[raw].forgot+=g===1;
     if(lastForgot>=0){if(s.seq.slice(lastForgot+1).some(x=>x.g>=3)){const next=ss[i+1];if(next)add(relearnGap,gapBin(next.day-s.day),next.seq[0].g);else relearnNoReturn++;}else relearnUnfinished++;}
   }
   const repaired=g===1&&s.seq.slice(1).some(x=>x.g>=3);
   if(repaired){length++;hasWindow ||=inWindow(s.day);}else flush(false);
 }
 flush(true);
}
// Event-count shares and word-count shares use separate denominators.
const leechComposition={},allStudied=data.words.filter(w=>w.seen_count>0||data.histories.has(w.id)),leeches=allStudied.filter(w=>!w.known_forever&&w.fsrs_lapses>=8);
for(const kind of Object.keys(byAttr)) {
 const cells={};
 for(const w of allStudied){const key=attrs.get(w.id)[kind];cells[key]??={all:0,leech:0};cells[key].all++;if(!w.known_forever&&w.fsrs_lapses>=8)cells[key].leech++;}
 leechComposition[kind]=cells;
}
const rawTiming={all:[],know:[],forgot:[],fuzzy:[]},validTiming={all:[],know:[],forgot:[],fuzzy:[]};let nonpositive=0,missingTimestamp=0;
const timingEvents=rows("SELECT id,answer,reviewed_on,reviewed_at FROM reviews WHERE direction='forward' AND reviewed_on BETWEEN '2026-10-01' AND '2026-11-02' ORDER BY reviewed_at,id").filter(x=>{if(!x.reviewed_at){missingTimestamp++;return false;}return true;});
for(let i=1;i<timingEvents.length;i++){
 const a=timingEvents[i-1],b=timingEvents[i];if(a.reviewed_on!==b.reviewed_on)continue;
 const seconds=(b.reviewed_at-a.reviewed_at)/1000;
 if(seconds<=0){nonpositive++;continue;}
 const kind=b.answer==='know'||b.answer==='known_forever'?'know':b.answer==='forgot'?'forgot':'fuzzy';
 rawTiming.all.push(seconds);rawTiming[kind].push(seconds);
 if(seconds<=60){validTiming.all.push(seconds);validTiming[kind].push(seconds);}
}
const timingSummary=a=>Object.fromEntries(Object.entries(a).map(([k,v])=>[k,{n:v.length,median:median(v),under2:v.filter(x=>x<2).length/Math.max(1,v.length),under5:v.filter(x=>x<5).length/Math.max(1,v.length)}]));
const totalAnswers=allEvents.length,days=new Set(allEvents.map(x=>x.day)).size;
let firstWords=0,newWords=0,priorFirstReal=0;const lapseShare={below3:0,from3:0,from8:0,from8Forgot:0};
for(const [id,ss]of data.sessions)for(const s of ss)if(inWindow(s.day)){
 firstWords++;newWords+=s.fresh&&!data.prior.has(id);priorFirstReal+=s.fresh&&data.prior.has(id);const w=data.words.find(w=>w.id===id);
 if((w.fsrs_lapses??0)>=3)lapseShare.from3++;else lapseShare.below3++;
 if((w.fsrs_lapses??0)>=8){lapseShare.from8++;lapseShare.from8Forgot+=s.seq[0].g===1;}
}
const result={window:{from:'2026-10-01',to:'2026-11-02',followupTo:'2026-11-10',days},observed:{answers:totalAnswers,firstWords,newWords,priorFirstReal,firstRealWords:newWords+priorFirstReal,answersPerDay:totalAnswers/days,firstPerDay:firstWords/days,newPerDay:newWords/days,...totalSample},newSuccess,newGap,newDetails,newNoReturn,relearnGap,relearnNoReturn,relearnUnfinished,chains,chainMedian:median(chainLengths),chainMax:Math.max(...chainLengths),chainCensored,chainN:chainLengths.length,byAttr,position,weekday,overallGap,leechComposition,studied:allStudied.length,leeches:leeches.length,lapseShare,timing:{raw:timingSummary(rawTiming),withinMinute:timingSummary(validTiming),nonpositive,missingTimestamp},secondsPerAnswer:data.secondsPerAnswer,confusion:{groups:groups.length,members:members.size},posCells:Object.values(exactPos).sort((a,b)=>b.n-a.n).map((r,i)=>({id:i+1,...r}))};
assert.equal(Object.values(byAttr.level).reduce((s,x)=>s+x.n,0),totalSample.n);
assert.equal(Object.values(position).reduce((s,x)=>s+x.n,0),totalSample.n);
save('diagnosis.json',result);console.log(JSON.stringify({observed:result.observed,confusion:result.confusion,timing:result.timing,secondsPerAnswer:data.secondsPerAnswer}));
