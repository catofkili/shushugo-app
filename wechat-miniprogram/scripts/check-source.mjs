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
const cloudFn = read('cloudfunctions/api/index.js');
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

// 微信的 require 不认 .json：数据模块由 build-data-modules.mjs 生成，源 json 改了没重跑就会两边不一致。
const { moduleSource, manualReviewPath, extractManualReview } = await import('./build-data-modules.mjs');
// 辨析人工名单必须和 iOS 那份 TS 逐字一致（分组判据两端要对得上，两边写的是同一个 confusion_mastered）。
const manualReviewInSync = fs.existsSync(manualReviewPath)
  ? JSON.stringify(await extractManualReview(), null, 2) + '\n' === read('src/data/confusion_manual_review.json')
  : 'skipped';
const dataModulesFresh = fs.readdirSync(path.join(root, 'src/data')).filter((f) => f.endsWith('.json'))
  .every((f) => fs.existsSync(path.join(root, 'src/data', f.replace(/\.json$/, '.js')))
    && read(`src/data/${f.replace(/\.json$/, '.js')}`) === moduleSource(read(`src/data/${f}`)));
const noJsonRequire = ['src/core', 'src/runtime', 'src/pages'].every((d) =>
  fs.readdirSync(path.join(root, d), { recursive: true }).filter((f) => f.endsWith('.js'))
    .every((f) => !/require\([^)]*\.json['"]\)/.test(read(`${d}/${f}`))));

// 协议/隐私版本必须和 frontend 的常量一致：Worker 按 frontend 那份判「是否同意当前版本」，
// 小程序落后一版就是登录 400 CONSENT_REQUIRED（2026-09-20 踩到：隐私政策 09-09 升版没带上小程序）。
const frontendVersion = (file, name) => {
  const fp = path.resolve(root, '..', 'frontend', 'src', 'lib', file);
  if (!fs.existsSync(fp)) return 'skipped';
  return fs.readFileSync(fp, 'utf8').match(new RegExp(`${name} = "([^"]+)"`))?.[1];
};
const consentInSync = ['skipped', config.match(/termsVersion: '([^']+)'/)?.[1]].includes(frontendVersion('user-agreement-content.ts', 'USER_AGREEMENT_VERSION'))
  && ['skipped', config.match(/privacyVersion: '([^']+)'/)?.[1]].includes(frontendVersion('privacy-policy-content.ts', 'PRIVACY_POLICY_VERSION'));

const checks = [
  ['consent versions match frontend', consentInSync],
  ['data modules are generated from json and nothing requires .json', dataModulesFresh && noJsonRequire],
  ['confusion manual review matches frontend', manualReviewInSync === true || manualReviewInSync === 'skipped'],
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
  // 两道签名（AppKey / session_key）都只在服务端；客户端只做 requestVirtualPayment 和 verify。
  ['payment is server-signed virtual payment', payment.includes('wx.requestVirtualPayment') && payment.includes('/pay/wechat/orders/verify') && !/hmac|sha256/i.test(payment)],
  ['entitlement cache is local', entitlements.includes('entitlement_cache') && entitlements.includes('fetchEntitlement')],
  ['wechat identity is explicit', auth.includes('wx.login') && auth.includes('auth/wechat') && auth.includes('access_token')],
  ['download retries and reports progress', wxPromise.includes('onProgressUpdate') && wxPromise.includes('retries')],
  ['runtime recovery smoke exists', runtimeSmoke.includes('corrupted database') && runtimeSmoke.includes('restoreDatabase')]
  ,['cloud snapshot format matches worker', snapshot.includes('master-nihongo-user-sqlite-v1') && syncClient.includes('/sync/push')]
  ,['iOS tombstones map to mini tombstones', snapshot.includes('copyTombstones') && snapshot.includes('mergeTombstones') && snapshot.includes('table_name') && snapshot.includes('natural_key')]
  ,['binary sync pull supports gzip', syncClient.includes('requestBinary') && snapshot.includes('gunzipSync')]
  // 快照必须压了再传：省用户流量，也是云函数入参 5 MB 上限的前提。
  ,['sync push is gzipped', syncClient.includes("'x-sync-compression': 'gzip'") && syncClient.includes('gzipSync(bytes)')]
  // 云开发模式下 Worker 地址只在云函数环境变量里，客户端只送路径 —— 否则云函数是个开放代理。
  ,['cloud proxy forwards only to WORKER_ORIGIN', cloudFn.includes('process.env.WORKER_ORIGIN') && cloudFn.includes("path.startsWith('/api/')") && wxPromise.includes("replace(/^https?:\\/\\/[^/]+/, '')")]
  ,['cloud transport is opt-in', wxPromise.includes('cloud.enabled()') && wxPromise.includes('cloud.isCloudFile(url)') && config.includes('cloudEnv')]
  ,['sync strips local auth state', snapshot.includes("'auth_access_token'") && snapshot.includes("'auth_user_id'")]
  ,['entitlement matches Worker isPro payload', entitlementCore.includes('source.isPro') && entitlementSmoke.includes('isPro: true')]
  // 汉字方向的流水必须写 kanji_reading:iOS 用这个字符串区分新的读音题和归档的旧写法题。
  // 写成 'kanji' 的话,小程序答过的卡在 iOS 那边不算今天答过,会被再问一遍。
  ,['kanji direction records kanji_reading', studyCore.includes("review: 'kanji_reading'") && studyCore.includes('reviewDirection(direction)')]
  ,['kanji cards filter by orthography', studyCore.includes('shouldStudyKanjiReading') && orthography.includes('band === \'kana\'')]
  ,['kanji prompt conceals the reading', indexPage.includes('reading-blank') && studyCore.includes('concealedReading')]
  ,['orthography data matches frontend', orthographyInSync === true || orthographyInSync === 'skipped']
  ,['grammar library is wired to local table', grammar.includes('FROM grammar_points') && grammarSmoke.includes('769')]
  ,['word library has local filters and memory bands', wordLibrary.includes('BAND_SQL') && wordLibrary.includes('setWordsKnownForever') && wordLibrarySmoke.includes('入口')]
  ,['quick and mistake queues are independent', modes.includes('mode_tasks') && modes.includes('createModePlan') && modesSmoke.includes("mode: 'quick'")]
  ,['confusion groups are computed from local words', confusion.includes('buildGroups') && confusion.includes('confusion_mastered') && confusionSmoke.includes('1881')]
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
