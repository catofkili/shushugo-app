import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { INPUT,OUT,db,requireFit,FIT_W,save,selfCheck } from './common.mjs';
const source=readFileSync(resolve(INPUT,'fsrs-fit/load.mjs'),'utf8');
const patched=source.replace('createRequire("/Users/lsc/Documents/shushugo/frontend/package.json")',`createRequire(${JSON.stringify(resolve(INPUT,'fsrs-fit/package.json'))})`);
assert.notEqual(patched,source);
const copy=resolve(OUT,'upstream-load.mjs');writeFileSync(copy,patched);
const args=[copy,resolve(INPUT,'fsrs-fit/cards.json'),resolve(INPUT,'live-frozen.db'),resolve(INPUT,'fsrs-fit/fit.json'),resolve(OUT,'upstream-smoke.json'),'60','1'];
const probe=spawnSync(process.execPath,args,{encoding:'utf8'});
assert.equal(probe.status,0,probe.stderr);assert(readFileSync(resolve(OUT,'upstream-smoke.json')).length>100);
const binding=requireFit('@open-spaced-repetition/binding');assert(new binding.FSRSBinding(FIT_W));
for(const [t,cols] of Object.entries({reviews:['word_id','reviewed_on','answer'],progress:['fsrs_stability','fsrs_difficulty','fsrs_due','fsrs_lapses','fsrs_reps'],words:['jlpt_level']})) {
 const got=new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(x=>x.name));for(const c of cols)assert(got.has(c),`${t}.${c}`);
}
assert.deepEqual(FIT_W,JSON.parse(readFileSync(resolve(INPUT,'fsrs-fit/fit.json'),'utf8')).g.wAll);
selfCheck();
const result={passed:true,sha256:createHash('sha256').update(readFileSync(resolve(INPUT,'live-frozen.db'))).digest('hex'),node:process.version,upstreamExit:probe.status,weights:FIT_W,upstreamSha256:createHash('sha256').update(source).digest('hex')};
save('preflight.json',result);console.log('PREFLIGHT OK: upstream load, both bindings, schema, weights, official scheduling equivalence');
