import './app-polyfills.weapp';
// 弹层随 lazy 加载，但 createPortal 适配器必须沿用主包 renderer，不能在异步块复制 React reconciler。
import './react-dom.weapp';
// 首页与邀请分包必须共享登录会话的十分钟节流状态。
import '../../../frontend/src/lib/referral';
// 这三份分别保有反馈订阅、支付运行态、可失效词性缓存；异步外壳和分包必须共享同一实例。
import '../../../frontend/src/lib/feedback';
import '../../../frontend/src/lib/purchases';
import '../../../frontend/src/lib/word-library';
// ⚠️ 标签页界面在 lazy 分包（platform/lazy-route.tsx），被它和别的分包同时用到的模块会各打一份拷贝。
// 纯函数和出厂内容缓存无所谓；**按数据库缓存用户数据的模块必须只有一份**——在这里静态引用一次，它就进主包，
// 异步块和各分包都用主包这份。grammarHighlights 的 dbCaches：详情页那份写了新重点，语法页那份缓存不失效就看不到。
import '../../../frontend/src/lib/grammarHighlights';
import { Suspense, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import type { AppContextValue, AppNavigationParams } from '../../../frontend/src/app/AppContext';
import { createAppActions } from '../../../frontend/src/app/actions';
import { getAppState, setAppState, useAppState, type AppState } from '../../../frontend/src/app/app-store';
import type { Page, StudyMode } from '../../../frontend/src/types/app';
import { useStudyStore } from '../../../frontend/src/hooks/useStudyStore';
import { useEntitlements } from '../../../frontend/src/hooks/useEntitlements';
import { recordDiagnosticRoute } from '../../../frontend/src/lib/diagnostics';
import { finishStartupTiming, perfRecord, perfTime, perfTimeAsync } from '../../../frontend/src/lib/perf-marks';
import { canUseFeature, type FeatureId } from '../../../frontend/src/lib/entitlements';
import { getProgressOverview } from '../../../frontend/src/lib/api';
import { ensureProgressInitialized } from '../../../frontend/src/lib/word-api/bootstrap';
import { afterPaint } from '../../../frontend/src/lib/after-paint';
import { useProgressUpdates } from '../../../frontend/src/lib/use-progress-updates';
import { registerCloudAutoSyncLifecycle, requestCloudAutoSync, getCloudSession, CLOUD_SYNC_EVENT, CLOUD_AUTH_EVENT, LEVEL_PLAN_TRIAL_EXPIRES_KEY, LEVEL_PLAN_TRIAL_NOTICE_KEY, type CloudSession, type CloudSyncEventDetail } from '../../../frontend/src/lib/sync-api';
import { defaultStudyMode, getStudyMode, saveStudyMode } from '../../../frontend/src/lib/studyMode';
import { getResolvedTheme, getStudyPreferences, PREFERENCES_EVENT } from '../../../frontend/src/lib/studyPreferences';
import { equippedItem, YUZU_EVENT } from '../../../frontend/src/lib/yuzu';
import { shouldShowLevelSetup } from '../../../frontend/src/lib/level-plan';
import { OPEN_GRAMMAR_FOUNDATION_EVENT } from '../../../frontend/src/lib/grammar-foundation-navigation';
import { consumePendingWeeklyReportWeekStart, WEEKLY_REPORT_NOTIFICATION_EVENT } from '../../../frontend/src/lib/notifications';
import { ACHIEVEMENT_UNLOCKED_EVENT } from '../../../frontend/src/lib/userProfile';
// 内容入口和 loader 都留在主包，避免优化器复制进 lazy 块后让 require.async 的相对路径错位。
import { readyForPageMount } from '../../scripts/taro-content.cjs';
import { readyForRoute } from '../../../frontend/src/lib/content-ready';
import { ensureDatabase } from './database-runtime.weapp';
import { StartupLoading } from './StartupLoading';
import { usePortalHost } from './portal-host.weapp';
import { PerfOverlay } from './preview-timing.weapp';
import { SquirrelTrail } from '../../../frontend/src/components/SquirrelTrail';
import { ROUTE_TABLE } from './route-table.cjs';
import { notifyMainScrollReachBottom } from './touch-adapter.weapp';
import { notifyStudyInteraction } from './use-study-activity.weapp';
import { closeAuth, closePaywall, getUiState, openAuth, openPaywall, queueAchievement, setLevelSetupOpen, setTrialEndedOpen, showNotice, subscribeUiState } from './ui-store.weapp';

type RouteItem = (typeof ROUTE_TABLE)[number];
let activeNavigate: (page: Page, params?: AppNavigationParams) => void = () => undefined;
let activeRefreshOverview = () => undefined;
let globalEventsInstalled = false;
let levelSetupChecked = false;
/** 这次弹的是新装的首次设定（不是从备考页主动打开的）。只有它会在云端进度找回后自动关掉。 */
let firstRunSetup = false;
let startupSynced = false;
let navigationRevision = 0;
let syncConflictNotice = '';
// 外壳只含渲染组件；在原有数据载入期并行预加载，不能给每个弹层增加一次点击后的下载等待。
let shellPromise: Promise<typeof import('../../../frontend/src/app/AppShell')> | null = null;
const loadShell = () => shellPromise ??= import(
  /* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../frontend/src/app/AppShell'
).catch((error) => { shellPromise = null; throw error; });

function installGlobalEvents() {
  if (globalEventsInstalled || typeof window === 'undefined') return;
  globalEventsInstalled = true;
  // ⚠️ 小程序原来只有打开「账号」页才会注册云同步（account/login/index.tsx）：别处登录后 requestCloudAutoSync('login') 发出去没人听，
  // 启动不拉、改动不推。2026-11-05 查线上，13 个微信账号只有 1 个传过快照——重装 / 换机后同一个微信永远是空账号，只能重新走先验。
  registerCloudAutoSyncLifecycle();
  window.addEventListener(OPEN_GRAMMAR_FOUNDATION_EVENT, (event) => {
    const ruleId = (event as CustomEvent<{ ruleId?: string }>).detail?.ruleId;
    activeNavigate('grammar-foundation', { selectedFoundationRuleId: ruleId ?? null });
  });
  window.addEventListener(WEEKLY_REPORT_NOTIFICATION_EVENT, (event) => {
    const detail = (event as CustomEvent<{ weekStart?: string | null }>).detail;
    activeNavigate('weekly-report', { weeklyReportStart: detail?.weekStart ?? null, weeklyReportEntry: 'notification' });
  });
  window.addEventListener(CLOUD_AUTH_EVENT, () => activeRefreshOverview());
  window.addEventListener(CLOUD_SYNC_EVENT, (event) => {
    const detail = (event as CustomEvent<CloudSyncEventDetail>).detail;
    if (!detail) return;
    if (detail.status === 'downloaded' || detail.status === 'merged') {
      syncConflictNotice = '';
      activeRefreshOverview();
      // 首次设定第一页是登录：老用户登录后进度拉回来了，就不用再设一遍（LevelSetup 那边会等这一次同步）。
      if (firstRunSetup && getUiState().levelSetupOpen && !shouldShowLevelSetup()) {
        firstRunSetup = false;
        setLevelSetupOpen(false);
        showNotice('已找回你的学习进度。', 3200);
      }
    } else if (detail.status === 'conflict' || detail.status === 'signed-out') {
      const message = detail.message ?? '两台设备都有新进度，请到设置中手动处理。';
      if (message !== syncConflictNotice) {
        syncConflictNotice = message;
        showNotice(message, 5000);
      }
    } else if (detail.status === 'uploaded') syncConflictNotice = '';
  });
  window.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, (event) => {
    const achievement = (event as CustomEvent<{ emoji: string; name: string }>).detail;
    if (achievement) queueAchievement(achievement);
  });
}
installGlobalEvents();

const isTab = (route: RouteItem) => route.tab;
const protectedPages = new Set<Page>(['account', 'personal-info', 'team']);
const proPages: Partial<Record<Page, FeatureId>> = { 'distinction-quiz': 'confusionGroups' };

const applyNativeBarTheme = (mode: 'light' | 'dark') => {
  const dark = mode === 'dark';
  const ignore = () => undefined;
  Taro.setNavigationBarColor({
    frontColor: dark ? '#ffffff' : '#000000',
    backgroundColor: dark ? '#171B17' : '#FBF6EC',
    animation: { duration: 0, timingFunc: 'linear' }
  }).catch(ignore);
  // 非 tab 页上调用会失败，吞掉即可：底栏样式是全局的，回到 tab 页时 useDidShow 会再设
  Taro.setTabBarStyle({
    color: dark ? '#B7B0A4' : '#81796D',
    selectedColor: dark ? '#A7D77D' : '#4F7A3A',
    backgroundColor: dark ? '#1F231E' : '#FBF8F1',
    borderStyle: dark ? 'black' : 'white'
  }).catch(ignore);
  Taro.setBackgroundColor({ backgroundColor: dark ? '#171B17' : '#FBF6EC' }).catch(ignore);
};

export function WeappPage({ page, Route }: { page: Page; Route: ComponentType }) {
  const route = ROUTE_TABLE.find((item) => item.page === page)!;
  const portalHost = usePortalHost();
  const state = useAppState();
  const studyStore = useStudyStore();
  const entitlements = useEntitlements();
  const ui = useSyncExternalStore(subscribeUiState, getUiState, getUiState);
  const [ready, setReady] = useState(false);
  const [shell, setShell] = useState<typeof import('../../../frontend/src/app/AppShell') | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [downloadPercent, setDownloadPercent] = useState<number | null | undefined>(undefined);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [skin, setSkin] = useState('');
  const [motionLevel, setMotionLevel] = useState(() => getStudyPreferences().motionLevel);
  const [pagePath] = useState(() => Taro.getCurrentInstance().router?.$taroPath ?? '');
  const [overview, setOverview] = useState<ReturnType<typeof getProgressOverview> | null>(null);
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [feedbackComposerOpen, setFeedbackComposerOpen] = useState(false);
  useProgressUpdates(() => { if (page === 'home') setOverviewRevision((value) => value + 1); });

  useEffect(() => {
    let cancelled = false;
    // 计时版里记每个页面从挂载到能用花多久（用户报「单词和语法加载几秒」「进组队页十秒」）；普通构建里 perfRecord 是空操作。
    const openedAt = Date.now();
    // 对战直达先应战、邀请页不被打断：不弹首次设定，也不标记已检查，之后回首页仍走首次设定。
    const setupExempt = page === 'invite' || (page === 'duel' && getAppState().duelId);
    // 首页只等数据库和外壳；角标独立等待当前模式，学习页在挂载之前等自己的完整内容。
    Promise.all([
      ensureDatabase({ onDownload: ({ percent }) => {
        if (cancelled) return;
        setDownloadPercent(percent);
        // 只有首次安装（本机没有存档）才会下出厂库：下载要好几秒，不让人盯着进度条，
        // 先把首次设定（登录 → 选等级）弹出来，库在它后面静默下完；保存按钮等库好了再亮（LevelSetup 的 dbReady）。
        if (!firstRunSetup && !levelSetupChecked && !setupExempt) { firstRunSetup = true; setLevelSetupOpen(true); }
      } }),
      loadShell().then((loaded) => { if (!cancelled) setShell(loaded); }),
      page === 'home' ? undefined : perfTimeAsync(`页面 · ${page} 内容就绪`, () => readyForPageMount(page, getAppState().launchStudyMode))
    ])
      .then(async () => {
        if (cancelled) return;
        setTheme(getResolvedTheme());
        setSkin(equippedItem('theme'));
        setCloudSession(await getCloudSession());
        if (cancelled) return;
        setReady(true);
        perfRecord(`页面 · ${page} 就绪`, Date.now() - openedAt);
        if (!levelSetupChecked && !setupExempt) {
          levelSetupChecked = true;
          // 首次安装在 onDownload 里已经弹出来了，这里不再判断（此时库刚下好，shouldShowLevelSetup 也必为 true）。
          if (!firstRunSetup) try {
            firstRunSetup = shouldShowLevelSetup();
            setLevelSetupOpen(firstRunSetup);
          } catch { /* 旧库可能尚无计划设置 */ }
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause)));
      });
    return () => { cancelled = true; };
  }, [page, retry]);

  useEffect(() => {
    if (!ready || page !== state.page) return;
    return afterPaint(() => {
      // 初始化会 persistSoon，必须先于启动同步；同步 flush 后才记 revision，避免首次找回被本机占位写入打断。
      ensureProgressInitialized();
      if (page === 'home' && !ui.levelSetupOpen) setOverview(perfTime('启动 · 今日主页数据计算', getProgressOverview));
      if (!startupSynced) { startupSynced = true; requestCloudAutoSync('startup'); }
    });
  }, [ready, page, state.page, ui.levelSetupOpen, overviewRevision]);

  useEffect(() => {
    if (page === 'home' && ready) finishStartupTiming('主页可渲染');
  }, [page, ready]);

  useEffect(() => {
    const refreshTheme = () => {
      setTheme(getResolvedTheme());
      setMotionLevel(getStudyPreferences().motionLevel);
      try { setSkin(equippedItem('theme')); } catch { /* database is still opening */ }
    };
    window.addEventListener(PREFERENCES_EVENT, refreshTheme);
    window.addEventListener(YUZU_EVENT, refreshTheme);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, refreshTheme);
      window.removeEventListener(YUZU_EVENT, refreshTheme);
    };
  }, []);

  // 原生标题栏和底栏不吃页面 CSS，深浅色只能靠 API 改（2026-10-16 作者：深色下顶栏 / 底栏还是浅色，改完再发布）。
  // 标题栏颜色是每个页面各自的：主题变了要设，每次页面重新显示也要再设一遍；底栏是全局的，一起设。
  // 浅色值和 app.config.js 里的默认值一致；深色标题栏取深色页面底色（#171B17，实测），底栏比它亮一档。
  useEffect(() => {
    if (ready) applyNativeBarTheme(theme);
  }, [ready, theme]);
  useDidShow(() => {
    try { applyNativeBarTheme(getResolvedTheme()); } catch { /* 偏好还没读到时保持 app.config 的浅色 */ }
  });

  const navigatePage = async (target: Page, params?: AppNavigationParams, authenticated = false) => {
    const revision = ++navigationRevision;
    if (protectedPages.has(target) && !cloudSession.token && !authenticated) {
      setAppState({ pendingAccountPage: target });
      openAuth();
      return;
    }
    const proFeature = proPages[target];
    if (proFeature && !canUseFeature(proFeature, entitlements)) {
      openPaywall(proFeature);
      return;
    }

    try { await readyForRoute(target, params?.studyMode ?? getStudyMode()); }
    catch { if (revision === navigationRevision) showNotice('内容读取失败，请重试。', 2600); return; }
    if (revision !== navigationRevision) return;

    const current = getAppState();
    const { studyMode, ...routeParams } = params ?? {};
    const patch: Partial<AppState> = { ...routeParams };
    if (studyMode) { patch.selectedStudyMode = studyMode; patch.launchStudyMode = studyMode; }
    if (target === 'word') {
      const mode = studyMode ?? getStudyMode() ?? defaultStudyMode;
      patch.selectedStudyMode = mode;
      patch.launchStudyMode = mode;
      patch.wordStudyRevision = current.wordStudyRevision + 1;
    }
    if (target === 'home') {
      const mode = getStudyMode();
      patch.selectedStudyMode = mode;
      patch.launchStudyMode = mode;
    }
    if (target === 'home' || target === 'profile') patch.selectedGrammarId = 'wa';
    if (target === 'grammar-foundation' && !('selectedFoundationRuleId' in patch)) patch.selectedFoundationRuleId = null;
    if (target === 'quick-study' && current.stubbornQuickIds && current.page !== 'word' && current.page !== 'weekly-report') patch.stubbornQuickIds = null;

    const tab = ROUTE_TABLE.find((item) => item.page === target)!;
    const stack = Taro.getCurrentPages();
    const redirect = !tab.tab && stack.length >= 9;
    const history = tab.tab ? [] : current.page === target
      ? current.pageHistory
      : redirect ? current.pageHistory.slice(0, -1) : [...current.pageHistory, current.page];
    setAppState({ ...patch, pageHistory: history, page: target });

    const navigation = tab.tab
      ? Taro.switchTab({ url: `/${tab.path}` })
      : redirect
        ? Taro.redirectTo({ url: `/${tab.path}` })
        : Taro.navigateTo({ url: `/${tab.path}` });
    void navigation.catch((cause) => {
      setAppState({ page: current.page, pageHistory: current.pageHistory });
      showNotice(String(cause?.errMsg ?? '页面打开失败'), 2600);
    });
  };

  const goBack = () => {
    ++navigationRevision;
    const pages = Taro.getCurrentPages();
    if (pages.length > 1) {
      const current = getAppState();
      setAppState({ pageHistory: current.pageHistory.slice(0, -1) });
      void Taro.navigateBack({ delta: 1 });
    } else {
      navigatePage('home');
    }
  };

  useDidShow(() => {
    ++navigationRevision; // 原生 tab 切换也要作废上一页还没完成的预取导航。
    recordDiagnosticRoute(page);
    activeNavigate = (target, params) => navigatePage(target, params);
    activeRefreshOverview = () => setOverviewRevision((value) => value + 1);
    const pendingWeek = consumePendingWeeklyReportWeekStart();
    if (pendingWeek) navigatePage('weekly-report', { weeklyReportStart: pendingWeek, weeklyReportEntry: 'notification' });
    setAppState((current) => ({
      page,
      ...(isTab(route) ? { pageHistory: [] } : current.page !== page && current.pageHistory.at(-1) === page
        ? { pageHistory: current.pageHistory.slice(0, -1) }
        : {})
    }));
    void Taro.setNavigationBarTitle({ title: route.title });
    void getCloudSession().then(setCloudSession).catch(() => undefined);
  });

  useEffect(() => {
    if (!ready || page !== state.page) return;
    const expiresAt = localStorage.getItem(LEVEL_PLAN_TRIAL_EXPIRES_KEY);
    if (!expiresAt || localStorage.getItem(LEVEL_PLAN_TRIAL_NOTICE_KEY) === expiresAt) return;
    let timer: number;
    const checkExpiry = () => {
      const remaining = Date.parse(expiresAt) - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkExpiry, Math.min(remaining + 100, 2_000_000_000));
        return;
      }
      const current = entitlements;
      if (current.isPro && current.source !== 'trial') return undefined;
      saveStudyMode('classic');
      setTrialEndedOpen(true);
      return undefined;
    };
    timer = window.setTimeout(checkExpiry, 0);
    return () => window.clearTimeout(timer);
  }, [ready, page, state.page, entitlements.isPro, entitlements.source]);

  const showModal = (message: string) => Taro.showModal({ title: '确认', content: message, confirmText: '确定', cancelText: '取消' }).then(({ confirm }) => confirm);
  const actions = createAppActions({
    navigate: (target, mode) => navigatePage(target, mode ? { studyMode: mode } : undefined),
    beginNavigation: () => { const revision = ++navigationRevision; return () => revision === navigationRevision; },
    showNotice,
    setOverview,
    confirm: showModal,
    markLearned: studyStore.markLearned,
    recordReview: studyStore.recordReview
  });
  const context: AppContextValue = {
    state,
    navigate: (target, params) => navigatePage(target, params),
    goBack,
    showNotice,
    requirePro: (featureId) => openPaywall(featureId),
    requireAccount: (target) => {
      if (cloudSession.token) { if (target) navigatePage(target); }
      else { setAppState({ pendingAccountPage: target ?? null }); openAuth(); }
    },
    openLevelSetup: () => setLevelSetupOpen(true),
    openFeedbackComposer: () => setFeedbackComposerOpen(true),
    closeFeedbackComposer: () => setFeedbackComposerOpen(false),
    feedbackComposerOpen,
    closePaywall,
    closeAuth: () => { closeAuth(); setAppState({ pendingAccountPage: null }); },
    handleAuthenticated: async (session) => {
      setCloudSession(session);
      try {
        const { syncUserProfileAfterLogin } = await import(/* webpackMode: "lazy", webpackChunkName: "lazy/profile-sync" */ '../../../frontend/src/lib/profile-sync');
        await syncUserProfileAfterLogin(session);
      }
      catch { showNotice('账号已登录；个人资料将在恢复联网后继续同步。', 3200); }
      const pending = getAppState().pendingAccountPage;
      setAppState({ pendingAccountPage: null });
      closeAuth();
      if (pending) navigatePage(pending, undefined, true);
    },
    cloudSession,
    entitlements,
    studyStore,
    overview,
    actions
  };
  if (error) {
    // 不放吉祥物图：本文件在主包。启动失败时用户唯一的出路曾是删小程序（会清空本机学习记录），所以必须有重试。
    const btn = 'rounded-xl px-4 py-2 text-center font-bold';
    const btnStyle = { backgroundColor: 'var(--ds-primary, #7EBE4F)', color: '#fff' };
    return (
      <View className="theme-light p-4" style={{ minHeight: '100vh' }}>
        <Text className="block text-lg font-bold" style={{ color: 'var(--ds-ink, #3A2E22)' }}>没能打开学习记录</Text>
        <Text className="block mt-2 text-sm" style={{ color: 'var(--ds-ink-2, #5E5448)', lineHeight: '22px' }}>记录还在这台手机上，没有丢。先点重试；请不要删除小程序，删除会清掉本机的学习记录。</Text>
        <View className="mt-4 flex gap-3">
          <View className={btn} style={btnStyle} onClick={() => { setError(''); setReady(false); setRetry((n) => n + 1); }}>重试</View>
          <View className={btn} style={btnStyle} onClick={() => { void Taro.setClipboardData({ data: `${error}\n${new Date().toISOString()}\n${page}` }); }}>复制错误信息</View>
        </View>
        <Text className="block mt-4 text-xs" style={{ color: 'var(--ds-ink-3, #8A7F70)', wordBreak: 'break-all' }}>{error}</Text>
      </View>
    );
  }
  // 首次安装、库还在下：外壳照样渲染，首次设定盖在加载画面上（见上面 onDownload）。其它情况仍是整页加载画面。
  if (!shell || (!ready && downloadPercent === undefined)) return <StartupLoading downloadPercent={downloadPercent} />;
  const { AppShell, markTrialNoticeRead } = shell;

  return (
    // Web theme/skin rules are rooted at html[data-theme]/html[data-skin].
    // htmltransform emits those anchors as .h5-html, so the mini app needs a
    // matching ancestor around AppShell (including its global overlays).
    <View className={`h5-html weapp-theme-root theme-${theme} attr-data-theme attr-data-motion attr-data-motion-${motionLevel}${skin ? ` skin-${skin} attr-data-skin` : ''}`}>
    <AppShell
      context={context}
      className={`app-shell weapp-app-shell relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#FFFBF2] via-[#FDF1DC] to-[#F6E9D2] text-[#3A2E22]${page === 'weekly-report' ? ' is-weekly-report' : ''}`}
      achievementPop={ui.achievementPop}
      notice={ui.notice}
      paywallTarget={ui.paywallTarget}
      authOpen={ui.authOpen}
      levelSetupOpen={ui.levelSetupOpen}
      dbReady={ready}
      trialEndedOpen={ui.trialEndedOpen}
      onAuthenticated={(session: CloudSession) => context.handleAuthenticated(session)}
      onClosePaywall={closePaywall}
      onCloseAuth={context.closeAuth}
      onLevelSetupComplete={(message) => {
        firstRunSetup = false;
        setLevelSetupOpen(false);
        showNotice(message, 5200);
        // 选了「暂不备考」就留在原页，不进备考页（和网页 App.tsx 一致）
        if (getStudyPreferences().jlptPlanEnabled) navigatePage('jlpt-plan');
      }}
      onDismissTrial={() => { markTrialNoticeRead(); setTrialEndedOpen(false); }}
      onViewPro={() => { markTrialNoticeRead(); setTrialEndedOpen(false); navigatePage('pro'); }}
    >
      {/* 只听按下和点击：touchmove / scroll 每帧都要从渲染层跨到逻辑层，背词页上每一帧还会让陪伴水豚重渲染一次（真机滚动卡）。
          学习时长按 60 秒没操作算走神（study-clock.ts），每次手指按下记一笔已经够了。 */}
      <View className={`weapp-route-root theme-${theme}${skin ? ` skin-${skin}` : ''}`}
        onTouchStart={() => notifyStudyInteraction(pagePath)}
        onClick={() => notifyStudyInteraction(pagePath)}>
        {/* Native page scrolling is disabled by the full-screen shell. A View with
            overflow-y:auto does not become a mini-program scroll container. */}
        {ready ? <ScrollView
          id="weapp-main-scroll"
          scrollY
          showScrollbar={false}
          enhanced
          lowerThreshold={240}
          onScrollToLower={() => notifyMainScrollReachBottom(pagePath)}
          className={`app-landscape-main weapp-app-main min-w-0 px-4 pb-4 pt-4${page === 'word' ? ' weapp-has-study-progress' : ''}`}
        >
          {page === 'word' && <View className="weapp-study-progress"><SquirrelTrail mode={state.selectedStudyMode} /></View>}
          <Suspense fallback={<View className="theme-light p-4"><Text>正在加载…</Text></View>}>
            <Route />
          </Suspense>
        </ScrollView> : <StartupLoading downloadPercent={downloadPercent} />}
        {/* Taro 删除 portal 子节点时会整组更新宿主的 childNodes。独立宿主让关闭弹层只更新这里，
            避免连带重建旁边的主 ScrollView、丢掉列表的原滚动位置。 */}
        <View ref={portalHost} />
      </View>
    </AppShell>
    {page === 'home' ? <PerfOverlay /> : null}
    </View>
  );
}
