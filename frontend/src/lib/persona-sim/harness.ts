import { expect } from "vitest";
import type { Database } from "sql.js";
import { PLAN_KINDS } from "../daily-plan";
import { PRIOR_ENTITIES } from "../prior-pacing";

/** 只复用 SQLite 编译后的语句，不缓存结果；每次仍在真实内存库重新执行、绑定参数。 */
export const reuseStatements = (db: Database, observeGrammar?: (params: unknown) => void) => {
  const prepare = db.prepare.bind(db);
  const run = db.run.bind(db);
  const countQueries = new Map<string, string>();
  const profile = process.env.PERSONA_SIM_PROFILE === "1" ? new Map<string, { ms: number; calls: number }>() : null;
  type Entry = { statement: ReturnType<Database["prepare"]>; free: () => boolean; busy: boolean };
  const cache = new Map<string, Entry>();
  db.prepare = (query, params) => {
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u.test(query) || cache.get(query)?.busy) return prepare(query, params);
    let entry = cache.get(query);
    if (!entry) {
      if (cache.size >= 512) {
        const oldest = [...cache].find(([, item]) => !item.busy);
        if (oldest) { oldest[1].free(); cache.delete(oldest[0]); }
      }
      // COUNT的IN子查询每题重建全词库成员表。只优化统计查询：先走当日流水索引，
      // 无额外过滤的words成员关系改成逐键EXISTS；不改候选/评分/FSRS，每日与原SQL对拍。
      const entity = Object.entries(PRIOR_ENTITIES).find(([, value]) => query.trimStart().startsWith(`SELECT COUNT(DISTINCT r.${value.idColumn}) FROM ${value.reviews} r`)
        && query.includes(`AND r.${value.idColumn} IN (SELECT ${value.idColumn} FROM ${value.table}`));
      let compiled = entity ? query.replace(`FROM ${entity[1].reviews} r`, `FROM ${entity[1].reviews} r INDEXED BY sim_${entity[0]}_day_scan`) : query;
      if (entity?.[0] === "words") compiled = compiled.replace(
        "AND r.word_id IN (SELECT word_id FROM progress WHERE 1)",
        "AND EXISTS (SELECT 1 FROM progress sim_member WHERE sim_member.word_id=r.word_id)"
      );
      if (entity) countQueries.set(query, compiled);
      const statement = prepare(compiled);
      if (profile) {
        const step = statement.step.bind(statement);
        statement.step = () => {
          const at = performance.now();
          try { return step(); } finally {
            const item = profile.get(query) ?? { ms: 0, calls: 0 };
            item.ms += performance.now() - at; item.calls++; profile.set(query, item);
          }
        };
      }
      if (/WHERE g\.id IN \(/u.test(query)) {
        const bind = statement.bind.bind(statement);
        statement.bind = params => { observeGrammar?.(params); return bind(params); };
      }
      entry = { statement, free: statement.free.bind(statement), busy: false };
      const owned = entry;
      statement.free = () => { owned.busy = false; statement.reset(); return true; };
    }
    cache.delete(query);
    cache.set(query, entry);
    entry.busy = true;
    if (params) entry.statement.bind(params);
    return entry.statement;
  };
  // sql.js 的 run 内部调用 prepare 的私有别名，须显式转到上面的同语句缓存。
  db.run = (query, params) => {
    if (!params || !/^\s*(INSERT|UPDATE|DELETE)\b/u.test(query)) return run(query, params);
    const statement = db.prepare(query, params);
    try { statement.step(); return db; } finally { statement.free(); }
  };
  return {
    verifyCounts(day: string) {
      for (const [query, compiled] of countQueries) {
        const counts = [query, compiled].map(sql => {
          const statement = prepare(sql, [day, day]);
          try { return statement.step() ? statement.get()[0] : null; } finally { statement.free(); }
        });
        expect(counts[1], "索引提示不得改变原生产计数").toBe(counts[0]);
      }
    },
    release() {
      if (profile) process.stdout.write(JSON.stringify([...profile].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)
        .map(([sql, timing]) => ({ query: sql.replace(/'[^']*'/gu, "?").replace(/\s+/gu, " ").slice(0, 250), ...timing }))) + "\n");
      db.prepare = prepare; db.run = run; for (const entry of cache.values()) entry.free();
    }
  };
};

/** 与旧 harness 一样，只加模拟库索引，不换候选 SQL，不缓存查询结果。 */
export const indexSimulation = (db: Database) => {
  for (const kind of PLAN_KINDS) {
    const { table, reviews, idColumn } = PRIOR_ENTITIES[kind];
    db.run(`CREATE INDEX IF NOT EXISTS sim_${kind}_card_day ON ${reviews} (${idColumn}, reviewed_on)`);
    db.run(`CREATE INDEX IF NOT EXISTS sim_${kind}_day_card ON ${reviews} (reviewed_on, ${idColumn})`);
    db.run(`CREATE INDEX IF NOT EXISTS sim_${kind}_day_scan ON ${reviews} (reviewed_on, answer, ${idColumn})`);
    db.run(`CREATE INDEX IF NOT EXISTS sim_${kind}_due ON ${table} (fsrs_due, ${idColumn}) WHERE known_forever = 0 AND seen_count > 0`);
  }
  db.run("CREATE INDEX IF NOT EXISTS sim_words_recent ON reviews (reviewed_on, direction, created_at DESC, id DESC, word_id, answer)");
  db.run("CREATE INDEX IF NOT EXISTS sim_kanji_order ON kanji_char_tasks (reviewed_on, order_index)");
  db.run("CREATE INDEX IF NOT EXISTS sim_confusion_order ON confusion_tasks (reviewed_on, order_index)");
  db.run("CREATE INDEX IF NOT EXISTS sim_grammar_level ON grammar_points (level, id)");
};
