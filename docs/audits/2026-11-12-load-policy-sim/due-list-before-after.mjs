// 手动离线对照，不进 CI；只打印聚合数，不导出词条或 id。先重新生成原生 shared/web.js。
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'Asia/Singapore';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(resolve(root, 'frontend/package.json'));
const initSqlJs = require('sql.js');
const frozen = resolve(root, 'frontend/.local/load-sim/live-frozen.db');
const hash = () => createHash('sha256').update(readFileSync(frozen)).digest('hex');
const beforeHash = hash();
const temporary = mkdtempSync(resolve(tmpdir(), 'load-policy-due-'));
let db;
try {
  const copy = resolve(temporary, 'live.db');
  copyFileSync(frozen, copy);
  const SQL = await initSqlJs({ locateFile: name => require.resolve(`sql.js/dist/${name}`) });
  db = new SQL.Database(new Uint8Array(readFileSync(copy)));
  const storage = new Map();
  globalThis.wx = {
    env: { USER_DATA_PATH: temporary },
    getStorageSync: key => storage.get(key) ?? '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  };
  globalThis.fetch = () => { throw new Error('对照脚本禁止联网'); };
  const web = require(resolve(root, 'wechat-miniprogram/src/shared/web.js'));
  const rows = (sql, params = []) => {
    const result = db.exec(sql, params)[0];
    return result ? result.values.map(values => Object.fromEntries(result.columns.map((column, i) => [column, values[i]]))) : [];
  };
  const quotas = JSON.parse(rows("SELECT value FROM app_state WHERE key='level_plan_quotas'")[0]?.value ?? '{}');
  assert.equal(typeof quotas.reviewCap, 'number', '冻结库缺少已同步的 reviewCap');
  storage.set('mn-study-preferences', JSON.stringify({ ...web.preferences.defaultStudyPreferences, ...quotas }));
  // 固定 SQL 随机源，便于重跑对拍；不改记忆、到期日、先验或新词状态。
  let seed = 20261112;
  db.create_function('random', () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed; });
  web.database.withDatabase(db, () => {
    const day = web.dbUtils.today();
    const end = web.dbUtils.studyDayEnd();
    const { WORD_FSRS, fsrsDueWordIds, fsrsDueCount, plannedDueCount, RECENT_LAPSE_HOURS } = web.fsrsStore;
    const threshold = web.fsrsScheduler.LEECH_LAPSE_THRESHOLD;
    const prior = fsrsDueWordIds(0, end); // 普通名额为 0 时，共享函数仍返回独立的先验名额。
    const pending = "(EXISTS (SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(progress.word_id AS TEXT)) AND NOT EXISTS (SELECT 1 FROM reviews prior_review WHERE prior_review.word_id=progress.word_id))";
    const eligible = `(${WORD_FSRS.eligible}) AND NOT ${pending}`;
    const where = `${eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)`;
    const ids = (sql, params) => rows(sql, params).map(row => Number(row.id));
    // 11-12 修改前的两条分支原样重放：先随机截 10 个顽固词；闸后超额才混池随机。
    const oldList = limit => {
      if (limit <= 0) return prior;
      const leech = ids(`SELECT word_id id FROM progress WHERE ${where} AND COALESCE(fsrs_lapses,0)>=? ORDER BY RANDOM() LIMIT 10`, [end.toISOString(), threshold]);
      const normal = Number(rows(`SELECT COUNT(*) n FROM progress WHERE ${where} AND COALESCE(fsrs_lapses,0)<?`, [end.toISOString(), threshold])[0].n);
      if (normal + leech.length > limit) return [...ids(`SELECT word_id id FROM progress WHERE ${where} AND (COALESCE(fsrs_lapses,0)<? OR word_id IN (${leech.map(() => '?').join(',') || 'NULL'})) ORDER BY RANDOM() LIMIT ?`, [end.toISOString(), threshold, ...leech, limit]), ...prior];
      const since = new Date(end.getTime() - RECENT_LAPSE_HOURS * 3600_000).toISOString();
      const candidates = rows(`SELECT word_id id, COALESCE(fsrs_lapses,0) lapses FROM progress WHERE ${where} ORDER BY (fsrs_due IS NULL) DESC, (fsrs_lapses>0 AND fsrs_last_review>=?) DESC, fsrs_due ASC, word_id ASC LIMIT ?`, [end.toISOString(), since, limit * 3]);
      const picked = [];
      let leeches = 0;
      for (const row of candidates) {
        if (picked.length >= limit) break;
        if (Number(row.lapses) >= threshold && leeches++ >= 10) continue;
        picked.push(Number(row.id));
      }
      return [...picked, ...prior];
    };
    const dueTotal = fsrsDueCount(end);
    const autoCap = web.reviewBudget.dailyReviewCap(0, day);
    console.log(JSON.stringify({ day, storedReviewCap: quotas.reviewCap, autoCap, dueTotal }));
    for (const [mode, cap] of [['stored', web.reviewBudget.dailyReviewCap(quotas.reviewCap, day)], ['automatic', autoCap]]) {
      for (const [rule, list] of [['before', oldList(cap)], ['after', fsrsDueWordIds(cap, end)]]) {
        const leeches = list.length ? Number(rows(`SELECT COUNT(*) n FROM progress WHERE word_id IN (${list.map(() => '?').join(',')}) AND COALESCE(fsrs_lapses,0)>=?`, [...list, threshold])[0].n) : 0;
        if (rule === 'after') assert.equal(list.length, plannedDueCount(end, WORD_FSRS, cap));
        console.log(JSON.stringify({ mode, rule, cap, length: list.length, leeches, dueTotal, autoCap }));
      }
    }
  });
} finally {
  db?.close();
  rmSync(temporary, { recursive: true, force: true });
  assert.equal(hash(), beforeHash, '冻结库不得被修改');
}
