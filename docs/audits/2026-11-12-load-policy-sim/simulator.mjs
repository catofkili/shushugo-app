import { DAY,START,EXAM,DEFAULT_W,FIT_W,T,scheduler,dayNum,dateStr,mulberry32,mean,spread,initial } from './common.mjs';
import assert from 'node:assert/strict';
export const scheduleOptions = { P0:{w:DEFAULT_W,r:.9,rebuild:false},P1a:{w:FIT_W,r:.8,rebuild:true},P1b:{w:FIT_W,r:.8,rebuild:false},P2a:{w:FIT_W,r:.85,rebuild:true},P2b:{w:FIT_W,r:.85,rebuild:false} };
export const config = (o={}) => ({schedule:'P0',newKind:'fixed',newValue:25,low:0,threshold:null,leech:null,intake:0,cap:1000000,selection:'random',supply:'N3',plateau:false,...o});
export const label = c => [c.schedule,c.newKind==='fixed'?`F${c.newValue}`:`${c.newKind}${c.threshold}-${c.low}`,c.leech?`L${c.leech}K${c.intake}`:'L0',c.cap<1000000?`C${c.cap}-${c.selection}`:'all',c.supply,c.plateau?'cap79':'main'].join('_');
export function prepare(data) {
  const starts={};for(const [k,p] of Object.entries(scheduleOptions)) starts[k]=initial(data,p.w,p.r,START-1,!p.rebuild);
  const ordinary=data.words.filter(w=>!w.known_forever&&!(w.seen_count>0)&&!w.fsrs_stability&&!data.histories.has(w.id));
  const supply={ordinaryN3:ordinary.filter(w=>['N5','N4','N3'].includes(w.level)&&w.pos!=='固定搭配').map(w=>w.level),N3:ordinary.filter(w=>['N5','N4','N3'].includes(w.level)).map(w=>w.level),N2:ordinary.filter(w=>['N5','N4','N3','N2'].includes(w.level)).sort((a,b)=>Number(b.level[1])-Number(a.level[1])).map(w=>w.level)};
  const weak=starts.P0.filter(c=>!c.retired&&c.card.stability<7).length;
  const history=data.learningDays.slice(-7).map(day=>{
    let cross=0,ok=0;for(const ss of data.sessions.values()) for(let i=1;i<ss.length;i++)if(ss[i].day===day){cross++;ok+=ss[i].seq[0].g>=3;}
    return {cross,ok};
  });
  const tails={normal:[],stubborn:[]};
  for(const [id,ss] of data.sessions)for(const s of ss)if(!data.prior.has(id)&&s.day>=dayNum('2026-10-01')&&s.day<=dayNum('2026-11-02'))for(let i=1;i<s.seq.length;i++) {
    const prev=s.seq[i-1];tails[prev.wrong>=3?'stubborn':'normal'].push(Math.min(3,s.seq[i].g));
  }
  return {starts,supply,weak,history,tails};
}
export function run(data,prepared,c,seed,calibration=null) {
  const opt=scheduleOptions[c.schedule], S=scheduler(opt.w,opt.r),rnd=mulberry32(seed);
  const live=structuredClone(calibration?initial(data,DEFAULT_W,.9,dayNum('2026-09-30'),false):prepared.starts[c.schedule]);
  const supply=[...(calibration?Array(10000).fill('N3'):prepared.supply[c.supply])];
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const sample=(a,n)=>{if(a.length<=n)return a;const b=[...a];for(let i=0;i<n;i++){const j=i+Math.floor(rnd()*(b.length-i));[b[i],b[j]]=[b[j],b[i]];}return b.slice(0,n);};
  const recallPool=[...data.pools.ok,...data.pools.hard];
  const start=calibration?dayNum('2026-10-01'):START,days=calibration?33:180;
  const learning=calibration?new Set(data.learningDays):null;
  const history=calibration?[]:structuredClone(prepared.history);
  const daily=[];let newTotal=0,braking=false,goodRun=0,switches=0,brakeDays=0,extended=0;
  for(let d=0;d<days;d++) {
    const today=start+d;
    if(learning&&!learning.has(today)) continue;
    const weak=live.filter(x=>!x.retired&&x.card.stability<7).length;
    const recent=history.slice(-7),den=recent.reduce((s,x)=>s+x.cross,0),acc=den?recent.reduce((s,x)=>s+x.ok,0)/den:null;
    if(c.newKind!=='fixed') {
      const trigger=c.newKind==='accuracy'?acc!==null&&recent.length===7&&acc<c.threshold:weak>c.threshold;
      const recover=c.newKind==='accuracy'?acc!==null&&acc>=c.threshold+(c.hysteresis??.05):weak<=Math.floor(c.threshold*(c.recoveryRatio??.8));
      if(!braking&&trigger){braking=true;goodRun=0;switches++;}
      if(braking){goodRun=recover?goodRun+1:0;if(goodRun>=3){braking=false;goodRun=0;switches++;}}
    }
    let newQuota=c.newKind==='fixed'?c.newValue:braking?c.low:25;
    if(braking)brakeDays++;
    let due=live.filter(x=>!x.retired&&x.due<=today);
    if(c.leech) due=[...due.filter(x=>x.card.lapses<c.leech),...sample(due.filter(x=>x.card.lapses>=c.leech),c.intake)];
    let cap=c.cap;
    if(calibration?.round>=2)cap=515;
    if(calibration?.round>=3) {
      const fraction=data.historicalBudget[today].fraction;
      cap=Math.round(cap*fraction);
    }
    // User's cap counts all first-seen words; application cap counts reviews only. Calibration follows the latter.
    const reviewSlots=calibration?cap:Math.max(0,cap-Math.min(newQuota,supply.length-newTotal));
    if(due.length>reviewSlots) due=c.selection==='lowest'?due.sort((a,b)=>T.R(a.mt,today-a.last)-T.R(b.mt,today-b.last)).slice(0,reviewSlots):sample(due,reviewSlots);
    let answers=0,first=0,cross=0,ok=0,forgot=0,newToday=0;
    const apply=(x,rawSeq,isNew)=>{
      let wrong=0,n=0,dt=isNew?0:Math.max(0,today-x.last),chosen=rawSeq;
      for(let i=0;i<200;i++) {
        let g=i<chosen.length?chosen[i]:pick(prepared.tails[wrong>=3?'stubborn':'normal']);
        if(i>0)g=Math.min(3,g);
        if(i===0&&g>=3)g=4;
        if(g<=2)wrong++;
        const mode=i===0&&g===4?'known':wrong>=3?'stubborn':'normal';
        const now=new Date(today*DAY+10*3600000+i*60000);
        x.card=S.one(x.card,now,g,mode);x.mt=T.step(x.mt,i===0?dt:0,g);n++;
        if(S.graduated(x.card,today))break;
        if(calibration?.round===1&&i===chosen.length-1)break;
        if(i>=chosen.length-1)extended++;
        assert(i<199,'Same-day graduation failed');
      }
      x.last=today;x.due=S.due(x.card,today);answers+=n;first++;
    };
    for(const x of due) {
      const p=Math.min(T.R(x.mt,today-x.last),c.plateau?.79:1),recall=rnd()<p;
      const seq=pick(recall?recallPool:data.pools.fail);
      if(today>x.last){cross++;ok+=seq[0]>=3;forgot+=seq[0]===1;}
      apply(x,seq,false);
    }
    for(let n=0;n<newQuota&&newTotal<supply.length;n++) {
      const x={card:null,mt:null,last:today,due:today,retired:false,level:supply[newTotal],firstDay:today,prior:false};
      apply(x,pick(data.pools.fresh),true);live.push(x);newTotal++;newToday++;
    }
    history.push({cross,ok});
    const pool=live.filter(x=>!x.retired&&x.card.lapses>=(c.leech??8)).length;
    const pool8=live.filter(x=>!x.retired&&x.card.lapses>=8).length;
    let knowledge=null;
    if(today===EXAM||d===59||d===179) {
      let remembered=0,latentRemembered=0,sumR=0,allEffective=0,n3Remembered=0,n3Expected=0,n3Count=0;
      for(const x of live) {
        const r=T.R(x.mt,today-x.last),eff=Math.min(r,c.plateau?.79:1);
        // The cap79 sensitivity cannot meet a recall threshold of .8; keep its latent count as a separate diagnostic.
        remembered+=eff>=.8;latentRemembered+=r>=.8;sumR+=r;allEffective+=eff;
        if(['N3','N4','N5'].includes(x.level)){n3Remembered+=eff>=.8;n3Expected+=eff;n3Count++;}
      }
      knowledge={remembered,latentRemembered,latentMeanR:sumR/live.length,meanR:allEffective/live.length,effective:allEffective/live.length,expected:allEffective,n3Remembered,n3Expected,n3Count,total:live.length};
    }
    daily.push({day:today,answers,first,cross,ok,forgot,newToday,newTotal,pool,pool8,weak,braking,knowledge,
      backlog:live.filter(x=>!x.retired&&x.due<=today).length});
  }
  const metrics={};
  for(const [k,a,b] of [['early',0,14],['middle',14,60],['late',150,180]]) {
    const ds=daily.slice(a,b);metrics[`${k}Answers`]=mean(ds.map(x=>x.answers));metrics[`${k}First`]=mean(ds.map(x=>x.first));
    metrics[`${k}Accuracy`]=ds.reduce((s,x)=>s+x.ok,0)/Math.max(1,ds.reduce((s,x)=>s+x.cross,0));
  }
  metrics.first=mean(daily.map(x=>x.first));metrics.answers=mean(daily.map(x=>x.answers));
  metrics.accuracy=daily.reduce((s,x)=>s+x.ok,0)/Math.max(1,daily.reduce((s,x)=>s+x.cross,0));
  metrics.forgot=daily.reduce((s,x)=>s+x.forgot,0)/Math.max(1,daily.reduce((s,x)=>s+x.cross,0));
  metrics.peak=Math.max(...daily.map(x=>x.answers));metrics.peakDay=daily.find(x=>x.answers===metrics.peak)?.day;
  metrics.totalAnswers=daily.reduce((s,x)=>s+x.answers,0);metrics.newTotal=newTotal;metrics.newExam=daily.find(x=>x.day===EXAM)?.newTotal??null;
  metrics.pool0=live.length? (calibration?0:prepared.starts[c.schedule].filter(x=>!x.retired&&x.card.lapses>=(c.leech??8)).length):0;
  for(const [k,index] of [['pool14',13],['pool60',59],['pool180',179]])metrics[k]=daily[index]?.pool??null;
  metrics.brakeDays=brakeDays;metrics.switches=switches;metrics.backlog180=daily.at(-1).backlog;metrics.extended=extended;
  for(const [key,d] of [['exam',EXAM],['d60',start+59],['d180',start+179]]) {
    const v=daily.find(x=>x.day===d)?.knowledge;
    if(v)for(const [k,value]of Object.entries(v))metrics[`${key}_${k}`]=value;
  }
  return {metrics,daily};
}
export function summarize(runs) {
  const keys=Object.keys(runs[0].metrics);return Object.fromEntries(keys.map(k=>[k,spread(runs.map(r=>r.metrics[k]).filter(x=>Number.isFinite(x)))]));
}
