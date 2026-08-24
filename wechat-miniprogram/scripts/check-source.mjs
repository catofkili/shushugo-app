import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sqlite = read('src/runtime/sqlite.js');
const store = read('src/runtime/database-store.js');
const config = read('src/config.js');
const content = read('src/runtime/content-update.js');
const backup = read('src/runtime/backup.js');
const audio = read('src/runtime/audio.js');
const payment = read('src/runtime/payment.js');
const entitlements = read('src/runtime/entitlements.js');
const entitlementCore = read('src/core/entitlements.js');
const auth = read('src/runtime/auth.js');
const wxPromise = read('src/runtime/wx-promise.js');
const runtimeSmoke = read('scripts/runtime-sim-smoke.mjs');
const snapshot = read('src/runtime/sync-snapshot.js');
const syncClient = read('src/runtime/sync-client.js');
const entitlementSmoke = read('scripts/entitlement-smoke.mjs');
const grammar = read('src/runtime/grammar.js');
const grammarSmoke = read('scripts/grammar-smoke.mjs');
const wordLibrary = read('src/runtime/word-library.js');
const wordLibrarySmoke = read('scripts/word-library-smoke.mjs');
const modes = read('src/core/study-core.js');
const modesSmoke = read('scripts/modes-smoke.mjs');
const confusion = read('src/runtime/confusion.js');
const confusionSmoke = read('scripts/confusion-smoke.mjs');
const achievements = read('src/runtime/achievements.js');
const achievementsSmoke = read('scripts/achievements-smoke.mjs');
const relief = read('src/runtime/daily-relief.js');
const reliefSmoke = read('scripts/daily-relief-smoke.mjs');
const studyCore = read('src/core/study-core.js');
const orthography = read('src/core/orthography.js');
const indexPage = read('src/pages/index/index.wxml');
const indexScript = read('src/pages/index/index.js');
const grammarPage = read('src/pages/grammar/index.wxml');
const settingsPage = read('src/pages/settings/index.wxml');

/*
 * 表记数据是从 iOS 端拷过来的，两份必须逐字节一致 —— 一边改了另一边没跟上，
 * 同一个词在两端就会一个出汉字卡、一个不出，而它们写的是同一张 kanji_reading_memory。
 * 源头在 frontend/scripts/audit-kanji-orthography.mjs，别在小程序这侧手改。
 */
const frontendOrthographyPath = path.resolve(root, '..', 'frontend', 'src', 'data', 'kanji_orthography.json');
const orthographyInSync = fs.existsSync(frontendOrthographyPath)
  ? fs.readFileSync(frontendOrthographyPath, 'utf8') === read('src/data/kanji_orthography.json')
  : 'skipped';

const checks = [
  ['WXWebAssembly adapter', sqlite.includes('wasmApi.instantiate(WASM_PATH, imports)')],
  ['sql.js callback bridge', sqlite.includes('done(instance, result?.module)')],
  ['FileSystemManager storage', read('src/runtime/wx-promise.js').includes('wx.getFileSystemManager()')],
  ['recursive database directory', store.includes('await makeDirectory(DB_DIRECTORY)')],
  ['atomic temp write', store.includes('await writeFile(TMP_PATH, bytes)')],
  ['atomic main rotation', store.includes('await renameFile(DB_PATH, PREV_PATH)')],
  ['database validation', sqlite.includes("['words', 'progress', 'app_state']")],
  ['seed URL is configurable', config.includes('seedDatabaseUrl')],
  ['content manifest update', content.includes('fetchContentManifest') && content.includes('mergeContentBytes')],
  ['content preserves progress', content.includes('INSERT OR IGNORE INTO progress')],
  ['content version marker', content.includes("content_protocol_version")],
  ['sync URL is configurable', config.includes('syncUrl')],
  ['backup export is atomic', backup.includes('backups') && backup.includes('renameFile')],
  ['backup strips auth token', backup.includes("auth_access_token") && backup.includes("auth_user_id") && backup.includes('copy.export')],
  ['audio is CDN-only', audio.includes('audioBaseUrl') && audio.includes('createInnerAudioContext')],
  ['payment is server-order only', payment.includes('paymentPath') && payment.includes('requestPayment')],
  ['entitlement cache is local', entitlements.includes('entitlement_cache') && entitlements.includes('fetchEntitlement')],
  ['wechat identity is explicit', auth.includes('wx.login') && auth.includes('auth/wechat') && auth.includes('access_token')],
  ['download retries and reports progress', wxPromise.includes('onProgressUpdate') && wxPromise.includes('retries')],
  ['runtime recovery smoke exists', runtimeSmoke.includes('corrupted database') && runtimeSmoke.includes('restoreDatabase')]
  ,['cloud snapshot format matches worker', snapshot.includes('master-nihongo-user-sqlite-v1') && syncClient.includes('/sync/push')]
  ,['iOS tombstones map to mini tombstones', snapshot.includes('copyTombstones') && snapshot.includes('mergeTombstones') && snapshot.includes('table_name') && snapshot.includes('natural_key')]
  ,['binary sync pull supports gzip', syncClient.includes('requestBinary') && snapshot.includes('readCompressedFile')]
  ,['sync strips local auth state', snapshot.includes("'auth_access_token'") && snapshot.includes("'auth_user_id'")]
  ,['entitlement matches Worker isPro payload', entitlementCore.includes('source.isPro') && entitlementSmoke.includes('isPro: true')]
  // 汉字方向的流水必须写 kanji_reading:iOS 用这个字符串区分新的读音题和归档的旧写法题。
  // 写成 'kanji' 的话,小程序答过的卡在 iOS 那边不算今天答过,会被再问一遍。
  ,['kanji direction records kanji_reading', studyCore.includes("review: 'kanji_reading'") && studyCore.includes('reviewDirection(direction)')]
  ,['kanji cards filter by orthography', studyCore.includes('shouldStudyKanjiReading') && orthography.includes('band === \'kana\'')]
  ,['kanji prompt conceals the reading', indexPage.includes('reading-blank') && studyCore.includes('concealedReading')]
  ,['orthography data matches frontend', orthographyInSync === true || orthographyInSync === 'skipped']
  ,['grammar library is wired to local table', grammar.includes('FROM grammar_points') && grammarSmoke.includes('741')]
  ,['word library has local filters and memory bands', wordLibrary.includes('BAND_SQL') && wordLibrary.includes('setWordsKnownForever') && wordLibrarySmoke.includes('入口')]
  ,['quick and mistake queues are independent', modes.includes('mode_tasks') && modes.includes('createModePlan') && modesSmoke.includes("mode: 'quick'")]
  ,['confusion groups are computed from local words', confusion.includes('buildGroups') && confusion.includes('confusion_mastered') && confusionSmoke.includes('1912')]
  ,['47 achievements are locally calculated', achievements.includes('CATALOG') && achievements.includes('achievement_unlocked') && achievementsSmoke.includes('47')]
  ,['rich study card data is rendered', indexPage.includes('pitch-card') && indexPage.includes('furigana-line') && indexPage.includes('dictionaryEntries') && indexScript.includes('modeLabel')]
  ,['maintenance controls are outside study home', !indexPage.includes('handleContentUpdate') && settingsPage.includes('handleContentUpdate')]
  ,['immersive grammar mode is wired', grammarPage.includes('沉浸阅读') && read('src/pages/grammar/index.js').includes('handleImmersive')]
  ,['daily relief is bounded and memory-neutral', relief.includes('MIN_ACTIVITY_WORDS') && relief.includes('reviews') && relief.includes('FSRS') && reliefSmoke.includes('120 个词昨天学习')]
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAIL ${name}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(checks.map(([name]) => `OK ${name}`).join('\n'));
}
