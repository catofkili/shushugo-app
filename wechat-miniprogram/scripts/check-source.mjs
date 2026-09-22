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
const sharedBundle = read('src/shared/web.js');
const syncSnapshot = read('src/runtime/sync-snapshot.js');
const achievementsSmoke = read('scripts/achievements-smoke.mjs');
const relief = read('src/runtime/daily-relief.js');
const reliefSmoke = read('scripts/daily-relief-smoke.mjs');
const studyCore = read('src/core/study-core.js');
const orthography = read('src/core/orthography.js');
const indexPage = read('src/pages/index/index.wxml');
const indexScript = read('src/pages/index/index.js');
const homePage = read('src/pages/home/index.wxml');
const homeScript = read('src/pages/home/index.js');
const extendedFeatures = read('src/runtime/extended-features.js');
const featuresSmoke = read('scripts/features-smoke.mjs');
const syncSnapshotSmoke = read('scripts/sync-snapshot-smoke.mjs');
const grammarPage = read('src/pages/grammar/index.wxml');
const settingsPage = read('src/pages/settings/index.wxml');
const teamRuntime = read('src/runtime/team.js');
const teamPage = read('src/pages/team/index.wxml');
const teamScript = read('src/pages/team/index.js');
const appConfig = read('src/app.json');
const projectConfig = JSON.parse(read('project.config.json'));

/*
 * 表记数据是从 iOS 端拷过来的，两份必须逐字节一致 —— 一边改了另一边没跟上，
 * 同一个词在两端就会一个出汉字卡、一个不出，而它们写的是同一张 kanji_reading_memory。
 * 源头在 frontend/scripts/audit-kanji-orthography.mjs，别在小程序这侧手改。
 */
const frontendOrthographyPath = path.resolve(root, '..', 'frontend', 'src', 'data', 'kanji_orthography.json');
const orthographyInSync = fs.existsSync(frontendOrthographyPath)
  ? fs.readFileSync(frontendOrthographyPath, 'utf8') === read('data/kanji_orthography.json')
  : 'skipped';

// 微信的 require 不认 .json：数据模块由 build-data-modules.mjs 生成，源 json 改了没重跑就会两边不一致。
const { moduleSource, manualReviewPath, extractManualReview } = await import('./build-data-modules.mjs');
// 辨析人工名单必须和 iOS 那份 TS 逐字一致（分组判据两端要对得上，两边写的是同一个 confusion_mastered）。
const manualReviewInSync = fs.existsSync(manualReviewPath)
  ? JSON.stringify(await extractManualReview(), null, 2) + '\n' === read('data/confusion_manual_review.json')
  : 'skipped';
const dataModulesFresh = fs.readdirSync(path.join(root, 'data')).filter((f) => f.endsWith('.json'))
  .every((f) => fs.existsSync(path.join(root, 'src/data', f.replace(/\.json$/, '.js')))
    && read(`src/data/${f.replace(/\.json$/, '.js')}`) === moduleSource(read(`data/${f}`)))
  && !fs.readdirSync(path.join(root, 'src/data')).some((f) => f.endsWith('.json'));
const noJsonRequire = ['src/core', 'src/runtime', 'src/pages', 'src/features'].every((d) =>
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
  ,['achievements come from the shared web bundle (achievements table, 47 items)', achievements.includes('extended-features') && !/(FROM|INTO) achievement_unlocked/.test(achievements) && sharedBundle.includes('FROM achievements') && !syncSnapshot.includes('achievement_unlocked') && achievementsSmoke.includes('47')]
  ,['feature layer delegates to frontend/src/lib, never re-implements it', extendedFeatures.includes("require('../shared/web')") && !/INSERT INTO (vocab_test_history|yuzu_ledger|weekly_reports)/.test(extendedFeatures) && sharedBundle.startsWith('/* 由 scripts/build-shared.mjs') && sharedBundle.includes('guessRate') && sharedBundle.includes('buildWeeklyReport')]
  ,['grammar favorites use grammar.ts string ids like the web', extendedFeatures.includes('grammar_ids') && syncSnapshotSmoke.includes('pdf-n5-017') && featuresSmoke.includes('pdf-n5-017')]
  ,['free accounts keep weekly reports off the cloud snapshot', syncSnapshot.includes('includeWeeklyReports') && featuresSmoke.includes('includeWeeklyReports: false')]
  ,['rich study card data is rendered', indexPage.includes('pitch-card') && indexPage.includes('furigana-line') && indexPage.includes('dictionaryEntries') && indexScript.includes('modeLabel')]
  ,['5173 home shell is wired to real local data', appConfig.indexOf('pages/home/index') < appConfig.indexOf('pages/index/index') && appConfig.includes('"tabBar"') && homePage.includes('今日收集') && homePage.includes('/pages/team/index') && homeScript.includes('getStudyHome') && homeScript.includes('studySummary')]
  ,['5173 extended features are native and subpackaged', appConfig.includes('"subPackages"') && ['/features/weekly/index','/features/jlpt-plan/index','/features/grammar-foundation/index','/features/kanji-readings/index','/features/favorites/index','/features/vocab-test/index','/features/distinction-quiz/index','/features/yuzu-shop/index'].every((route) => homePage.includes(route)) && extendedFeatures.includes('vocabTest') && featuresSmoke.includes('词汇量测试不得写学习进度')]
  ,['maintenance controls are outside study home', !indexPage.includes('handleContentUpdate') && settingsPage.includes('handleContentUpdate')]
  ,['real team feature replaces placeholder', appConfig.includes('pages/team/index') && indexPage.includes('组队学习') && teamRuntime.includes('/teams/activity') && teamRuntime.includes('/teams/report') && teamPage.includes('open-type="share"') && teamScript.includes('onShareAppMessage')]
  ,['release UI excludes developer diagnostics', !['handleSave', 'handleRestore', 'handleDue', 'entitlement.source', 'auth.userId', '原子写盘', '冷启动恢复'].some((text) => settingsPage.includes(text)) && !indexScript.includes('status.paths.dbPath')]
  ,['release upload omits source maps and checks domains', projectConfig.setting.uploadWithSourceMap === false && projectConfig.setting.urlCheck === true]
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
