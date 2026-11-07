// Build-time only: use the real migrations/FSRS definitions without opening a browser,
// fetching a database, or scheduling persistence. Nothing here enters a release bundle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));

export async function loadFactoryRuntime(extraEntry = "") {
  const result = await build({
    stdin: {
      contents: `export * from './src/lib/study-core';
        export * from './src/lib/fsrs-store';
        export { setDatabase } from 'factory:database';
        ${extraEntry}`,
      resolveDir: root, sourcefile: "factory-runtime.ts", loader: "ts"
    },
    bundle: true, platform: "node", format: "cjs", write: false, loader: { ".sql": "text" },
    define: { "import.meta.env.DEV": "false", __TARO_PERF_OVERLAY__: "false" },
    plugins: [{
      name: "factory-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^factory:database$/ }, () => ({ path: "database", namespace: "factory" }));
        builder.onResolve({ filter: /(^|\/)database$/ }, ({ path: name, resolveDir }) => {
          if (path.resolve(resolveDir, name) === path.join(root, "src/lib/database")) {
            return { path: "database", namespace: "factory" };
          }
        });
        builder.onLoad({ filter: /.*/, namespace: "factory" }, () => ({ contents:
          "let db; export const getDatabase = () => db; export const setDatabase = value => { db = value; };" }));
        builder.onLoad({ filter: /[/\\]lib[/\\]storage\.ts$/ }, () => ({ contents:
          "export const scheduleSave = () => {}; export const requestFullSnapshot = () => {}; export const saveRecoverySnapshot = async () => 'factory-test';" }));
        builder.onLoad({ filter: /[/\\]lib[/\\]study-core\.ts$/ }, ({ path: name }) => ({
          contents: readFileSync(name, "utf8") + `
            export const factoryVersions = {
              jlpt_seed_version: JLPT_SEED_VERSION,
              jlpt_word_metadata_version: JLPT_WORD_METADATA_VERSION,
              jlpt_level_override_version: JLPT_LEVEL_OVERRIDE_VERSION,
              dictionary_supplement_version: DICTIONARY_SUPPLEMENT_VERSION,
              furigana_version: FURIGANA_VERSION
            };
            export const factoryRepairVersion = CONTENT_MARKER_REPAIR_VERSION;
            export const replayFactoryContent = async () => {
              await ensureDictionarySupplementSeed();
              await ensureJlptWordSeed();
              await ensureJlptLevelOverrides();
              await ensureFuriganaAnnotations();
            };`, loader: "ts"
        }));
      }
    }]
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const contentDump = db => ["words", "grammar_points", "dictionary_entries"].map(table =>
  db.exec(`SELECT * FROM ${table} ORDER BY 1`)[0]
);

// A marker is a claim about content, not just a version string. Force the actual
// covered migrations on a disposable clone; missing seed identities must also fail
// (the runtime's 10k-row shortcut deliberately does not check every identity).
export async function assertFactoryContent(db, runtime) {
  for (const [key, version] of Object.entries(runtime.factoryVersions)) {
    assert.equal(db.exec("SELECT value FROM app_state WHERE key=?", [key])[0]?.values[0][0], version, key);
  }
  const identities = new Set(db.exec("SELECT kanji,kana FROM words")[0].values.map(row => JSON.stringify(row)));
  const seed = JSON.parse(readFileSync(path.join(root, "src/data/jlpt_words_seed.json"), "utf8"));
  for (const [, kana, kanji] of seed) {
    assert(identities.has(JSON.stringify([kanji, kana])), `出厂库缺少种子词 ${kanji}/${kana}`);
  }
  const expected = contentDump(db);
  const clone = new db.constructor(db.export());
  runtime.setDatabase(clone);
  try {
    for (const key of Object.keys(runtime.factoryVersions)) clone.run("DELETE FROM app_state WHERE key=?", [key]);
    await runtime.replayFactoryContent();
    assert.deepEqual(contentDump(clone), expected, "内容版本戳与真实迁移结果不一致；请重新 bake 出厂库");
  } finally {
    // persistContentSoon dynamically imports its no-op storage shim.
    await Promise.resolve();
    clone.close();
    runtime.setDatabase(db);
  }
}

export function assertFactoryFsrs(db, runtime) {
  for (const entity of [runtime.WORD_FSRS, runtime.KANJI_FSRS, runtime.GRAMMAR_FSRS]) {
    const before = db.exec(`PRAGMA table_info(${entity.table})`)[0]?.values;
    // Calling the production helper on a clone also checks types/defaults below
    // without ever repairing the artifact being verified.
    const clone = new db.constructor(db.export());
    runtime.setDatabase(clone);
    try {
      runtime.ensureFsrsColumns(entity);
      const after = clone.exec(`PRAGMA table_info(${entity.table})`)[0]?.values;
      assert.deepEqual(before, after, `${entity.table} 缺少预建 FSRS 列`);
      for (const row of after.filter(row => String(row[1]).startsWith("fsrs_"))) {
        assert.equal(row[2], /stability|difficulty/.test(row[1]) ? "REAL" : /due|last_review/.test(row[1]) ? "TEXT" : "INTEGER");
        assert.deepEqual(row.slice(3), [0, null, 0], `${entity.table}.${row[1]} 必须可空且无默认状态`);
      }
    } finally { clone.close(); runtime.setDatabase(db); }
  }
}
