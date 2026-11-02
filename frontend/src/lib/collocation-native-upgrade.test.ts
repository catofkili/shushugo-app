import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("原生小程序生成物从分包迁移 v3 旧库，恢复备份也重新补档位", () => {
  const result = execFileSync(process.execPath, ["--input-type=commonjs", "-"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8",
    input: `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
(async () => {
  const SQL = await require('./wechat-miniprogram/src/vendor/sql-wasm.js')({ wasmBinary: fs.readFileSync('./wechat-miniprogram/src/assets/sql-wasm.wasm') });
  const old = new SQL.Database(fs.readFileSync('./frontend/public/nihongo.db'));
  const content = require('./frontend/src/data/jlpt_collocation_content.json');
  for (const row of content.entries) old.run("INSERT INTO words (kanji,kana,meaning,pos,jlpt_level) VALUES (?,?,?,'固定搭配',?)", [row.surface,row.kana,row.meaning,row.level]);
  old.run("INSERT OR REPLACE INTO app_state (key,value) VALUES ('jlpt_collocation_content_version','2026-10-18-jlpt-collocations-zh-v3')");
  const bytes = old.export(); old.close();
  const original = Module._load;
  Module._load = function(request,parent,isMain) {
    if (parent?.filename.endsWith('/runtime/database-store.js')) {
      if (request === './wx-promise') return { fileExists: async path => path.endsWith('/nihongo.db'), readFile: async () => bytes };
      if (request === './sqlite') return { openAndValidate: async input => new SQL.Database(input) };
    }
    return original.call(this,request,parent,isMain);
  };
  const settings = new Map();
  globalThis.wx = { env: { USER_DATA_PATH: '/test' }, getFileSystemManager: () => ({}), getStorageSync: key => settings.get(key) ?? '', setStorageSync: (key,value) => settings.set(key,value), removeStorageSync: key => settings.delete(key) };
  const store = require('./wechat-miniprogram/src/runtime/database-store.js');
  store.saveDatabase = async () => ({});
  for (const open of [() => store.ensureDatabase(), () => store.restoreDatabase()]) {
    const db = await open();
    assert.deepEqual(db.exec("SELECT collocation_tier,COUNT(*) FROM words WHERE pos='固定搭配' GROUP BY collocation_tier ORDER BY collocation_tier")[0].values, [[0,51],[1,309],[2,430]]);
    assert.match(db.exec("SELECT value FROM app_state WHERE key='jlpt_collocation_content_version'")[0].values[0][0], /-v4$/);
    await store.closeDatabase();
  }
  Module._load = original;
  console.log('native-v4-ok');
})().catch(error => { console.error(error); process.exitCode=1; });
`
  });
  expect(result).toContain("native-v4-ok");
});
