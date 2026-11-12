import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const INPUT = resolve(ROOT, 'frontend/.local/load-sim');
export const OUT = resolve(INPUT, 'policy-results');
mkdirSync(OUT, { recursive: true });
export const requireFit = createRequire(resolve(INPUT, 'fsrs-fit/package.json'));
export const { fsrs, createEmptyCard, State } = requireFit('ts-fsrs');
export const params = JSON.parse(readFileSync(resolve(INPUT, 'fsrs-fit/params.json'), 'utf8'));
export const DEFAULT_W = params.default.w, FIT_W = params.fitAll.w;
assert.equal(FIT_W.length, 21); assert(FIT_W.every(Number.isFinite));
export const db = new DatabaseSync(resolve(INPUT, 'live-frozen.db'), { readOnly: true });
export const rows = (sql, ...args) => db.prepare(sql).all(...args);
export const DAY = 86400000;
export const dayNum = d => Date.parse(`${d}T00:00:00Z`) / DAY;
export const dateStr = d => new Date(d * DAY).toISOString().slice(0, 10);
export const START = dayNum('2026-11-11'), EXAM = dayNum('2026-12-06');
export const save = (name, value) => writeFileSync(resolve(OUT, name), JSON.stringify(value));
export const read = name => JSON.parse(readFileSync(resolve(OUT, name), 'utf8'));
export const median = a => { const s = [...a].sort((a,b)=>a-b); return s.length ? (s[(s.length-1)>>1]+s[s.length>>1])/2 : null; };
export const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
export const spread = a => ({ mid: median(a), min: Math.min(...a), max: Math.max(...a) });
export const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// Adapted from the supplied load.mjs: fitted truth next_state/curve and official scheduling steps.
export const model = w => {
  const f = fsrs({ w, enable_fuzz: false, enable_short_term: true, relearning_steps: ['10m','10m'] });
  return { step: (m, dt, g) => f.next_state(m, dt, g), R: (m, t) => m ? f.forgetting_curve(Math.max(0,t), m.stability) : 0 };
};
export const scheduler = (w, retention) => {
  const by = Object.fromEntries(['normal','known','stubborn'].map(mode => [mode, fsrs({
    w, request_retention: retention, maximum_interval: 365, enable_fuzz: false, enable_short_term: true,
    learning_steps: mode === 'known' ? [] : ['1m','10m'],
    relearning_steps: mode === 'known' ? [] : mode === 'stubborn' ? ['10m','10m','30m'] : ['10m','10m']
  })]));
  return {
    one: (card, now, g, mode) => by[mode].next(card ?? createEmptyCard(now), now, g).card,
    // next and repeat use the same official engine; self-check verifies exact equality.
    due: (card, day) => Math.max(day+1, Math.floor((Math.min(+card.due, +card.last_review+365*DAY)+4*3600000)/DAY)),
    graduated: (card, day) => card.state === State.Review && +card.due > day*DAY+20*3600000,
    by
  };
};
export const T = model(FIT_W);
export function loadData() {
  const prior = new Map(rows("SELECT * FROM level_prior_baselines WHERE entity='words'").map(r=>[Number(r.entity_key),r]));
  const words = rows(`SELECT w.id, w.jlpt_level level, w.collocation_tier tier, w.pos,
    p.* FROM words w JOIN progress p ON p.word_id=w.id`);
  const histories = new Map();
  for (const e of rows(`SELECT id,word_id,answer,reviewed_on,reviewed_at,created_at,scheduler_mode
    FROM reviews WHERE direction='forward' ORDER BY word_id,COALESCE(reviewed_at,strftime('%s',created_at)*1000),id`)) {
    const id = Number(e.word_id);
    if (!histories.has(id)) histories.set(id, []);
    const a = histories.get(id), prev = a.at(-1), day = dayNum(e.reviewed_on);
    let at = Number(e.reviewed_at) || Date.parse(String(e.created_at).replace(' ','T') + (String(e.created_at).endsWith('Z')?'':'Z'));
    if (!Number.isFinite(at)) at=day*DAY+10*3600000;
    at=Math.max(at,(prev?.at??0)+1000);
    const first=!prev || prev.day!==day, correct=['know','known_forever'].includes(e.answer);
    const wrong=(first?0:prev.wrong)+(['forgot','fuzzy'].includes(e.answer)?1:0);
    const mode=['normal','known','stubborn'].includes(e.scheduler_mode)?e.scheduler_mode:first&&correct?'known':wrong>=3?'stubborn':'normal';
    const g=e.answer==='forgot'?1:e.answer==='fuzzy'?2:e.answer==='known_forever'||mode==='known'?4:3;
    a.push({day,at,g,mode,wrong,answer:e.answer,eventId:e.id,dt:prev?Math.max(0,day-prev.day):0});
  }
  const sessions = new Map();
  for(const [id,rs] of histories) {
    const ss=[];
    for(const r of rs) {
      if(!ss.length||ss.at(-1).day!==r.day) ss.push({day:r.day,seq:[],fresh:!ss.length});
      ss.at(-1).seq.push(r);
    }
    sessions.set(id,ss);
  }
  const pools={fresh:[],ok:[],hard:[],fail:[]};
  const poolInfo={complete:0,incomplete:0};
  for(const [id,ss] of sessions) for(const s of ss) {
    if(prior.has(id)) continue;
    if(s.day<dayNum('2026-10-01')||s.day>dayNum('2026-11-02')) continue;
    const seq=s.seq.map(r=>r.g);
    // Censored sessions remain available for historical calibration; future runs finish the official steps.
    pools[s.fresh?'fresh':seq[0]>=3?'ok':seq[0]===2?'hard':'fail'].push(seq);
    poolInfo[seq.at(-1)>=3?'complete':'incomplete']++;
  }
  const learningDays=[...new Set(rows("SELECT DISTINCT reviewed_on FROM reviews WHERE direction='forward' AND reviewed_on BETWEEN '2026-10-01' AND '2026-11-02'").map(x=>dayNum(x.reviewed_on)))].sort((a,b)=>a-b);
  const historicalBudget=Object.fromEntries(learningDays.map(d=>{
    const tasks=rows('SELECT COUNT(*) n FROM stage1_tasks WHERE reviewed_on=?',dateStr(d))[0].n;
    const n=rows("SELECT COUNT(DISTINCT word_id) n FROM reviews WHERE direction='forward' AND reviewed_on=?",dateStr(d))[0].n;
    return [d,{tasks,first:n,fraction:Math.min(1,n/Math.max(1,tasks))}];
  }));
  const matchedTime=rows(`SELECT SUM(t.seconds) seconds,SUM(r.n) answers FROM word_study_time t JOIN
    (SELECT reviewed_on,COUNT(*) n FROM reviews WHERE direction='forward' AND reviewed_on BETWEEN '2026-10-01' AND '2026-11-02' GROUP BY 1) r ON r.reviewed_on=t.studied_on`)[0];
  const data={words,histories,sessions,prior,pools,poolInfo,learningDays,historicalBudget,secondsPerAnswer:matchedTime.seconds/matchedTime.answers,matchedTime};
  assert(Object.values(pools).every(a=>a.length));
  return data;
}
export function storedCard(w) {
  if(!(w.fsrs_stability>0)) return null;
  return {stability:w.fsrs_stability,difficulty:w.fsrs_difficulty,due:new Date(w.fsrs_due),last_review:new Date(w.fsrs_last_review??w.fsrs_due),
    state:w.fsrs_state??2,learning_steps:w.fsrs_steps??0,reps:w.fsrs_reps??1,lapses:w.fsrs_lapses??0,elapsed_days:0,scheduled_days:0};
}
export function priorCard(p) {
  return {stability:p.stability,difficulty:p.difficulty,due:new Date(p.due),last_review:new Date(p.last_review),state:p.state,learning_steps:p.steps,reps:p.reps,lapses:p.lapses,elapsed_days:0,scheduled_days:0};
}
export function initial(data, schedW=DEFAULT_W, retention=.9, cutoff=START-1, useStored=true) {
  const S=scheduler(schedW,retention), live=[];
  for(const w of data.words) {
    const rs=(data.histories.get(w.id)??[]).filter(r=>r.day<=cutoff);
    const prior=data.prior.get(w.id);
    const validPrior=prior&&Date.parse(prior.updated_at)<=(cutoff*DAY+20*3600000);
    if(!rs.length&&!validPrior) continue;
    let card=null,mt=null,last=0,priorInserted=false;
    const insertPrior=()=>{card=priorCard(prior);mt={stability:prior.stability,difficulty:prior.difficulty};last=Math.floor((Date.parse(prior.last_review)+4*3600000)/DAY);priorInserted=true;};
    for(const r of rs) {
      if(validPrior&&!priorInserted&&Date.parse(prior.updated_at)<=r.at)insertPrior();
      card=S.one(card,new Date(r.at),r.g,r.mode);
      mt=T.step(mt,mt?Math.max(0,r.day-last):0,r.g);last=r.day;
    }
    if(validPrior&&!priorInserted)insertPrior();
    if(useStored) card=storedCard(w)??card;
    const retired=cutoff===START-1?!!w.known_forever:rs.some(r=>r.answer==='known_forever');
    if(!mt||!card) continue;
    live.push({card,mt,last,due:Math.floor((+card.due+4*3600000)/DAY),retired,level:w.level,firstDay:rs[0]?.day??last,prior:!!validPrior});
  }
  return live;
}
export function selfCheck() {
  for(const w of [DEFAULT_W,FIT_W]) for(const retention of [.8,.85,.9]) {
    const S=scheduler(w,retention);let card=null;
    for(let d=0;d<20;d++) for(let i=0;i<5;i++) {
      const now=new Date((dayNum('2026-01-01')+d)*DAY+10*3600000+i*60000);
      const g=[1,3,2,3,4][i],mode=i===4?'known':i>=3?'stubborn':'normal';
      const before=card??createEmptyCard(now);
      assert.deepEqual(S.by[mode].repeat(before,now)[g].card,S.one(card,now,g,mode));
      card=S.one(card,now,g,mode);
    }
  }
  const a=T.step(null,0,4);assert(T.R(a,10)<T.R(a,1));assert(T.R(a,0)===1);
}
