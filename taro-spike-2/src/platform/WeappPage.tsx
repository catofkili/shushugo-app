import './app-polyfills.weapp';
import { Suspense, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import type { AppContextValue, AppNavigationParams } from '../../../frontend/src/app/AppContext';
import { AppShell, markTrialNoticeRead } from '../../../frontend/src/app/AppShell';
import { createAppActions } from '../../../frontend/src/app/actions';
import { getAppState, setAppState, useAppState, type AppState } from '../../../frontend/src/app/app-store';
import type { Page, StudyMode } from '../../../frontend/src/types/app';
import { useStudyStore } from '../../../frontend/src/hooks/useStudyStore';
import { useEntitlements } from '../../../frontend/src/hooks/useEntitlements';
import { canUseFeature, type FeatureId } from '../../../frontend/src/lib/entitlements';
import { getProgressOverview } from '../../../frontend/src/lib/api';
import { getCloudSession, CLOUD_SYNC_EVENT, CLOUD_AUTH_EVENT, LEVEL_PLAN_TRIAL_EXPIRES_KEY, LEVEL_PLAN_TRIAL_NOTICE_KEY, type CloudSession, type CloudSyncEventDetail } from '../../../frontend/src/lib/sync-api';
import { syncUserProfileAfterLogin } from '../../../frontend/src/lib/profile-sync';
import { defaultStudyMode, getStudyMode, saveStudyMode } from '../../../frontend/src/lib/studyMode';
import { getResolvedTheme, PREFERENCES_EVENT } from '../../../frontend/src/lib/studyPreferences';
import { equippedItem, YUZU_EVENT } from '../../../frontend/src/lib/yuzu';
import { shouldShowLevelSetup } from '../../../frontend/src/lib/level-plan';
import { OPEN_GRAMMAR_FOUNDATION_EVENT } from '../../../frontend/src/lib/grammar-foundation-navigation';
import { consumePendingWeeklyReportWeekStart, WEEKLY_REPORT_NOTIFICATION_EVENT } from '../../../frontend/src/lib/notifications';
import { ACHIEVEMENT_UNLOCKED_EVENT } from '../../../frontend/src/lib/userProfile';
import { ready as readyForGrammar, readyForKanji } from '../../scripts/taro-content.cjs';
import { ensureDatabase } from './database-runtime.weapp';
import { usePortalHost } from './portal-host.weapp';
import { ROUTE_TABLE } from './route-table.cjs';
import { closeAuth, closePaywall, getUiState, openAuth, openPaywall, queueAchievement, setLevelSetupOpen, setTrialEndedOpen, showNotice, subscribeUiState } from './ui-store.weapp';

type RouteItem = (typeof ROUTE_TABLE)[number];
let activeNavigate: (page: Page, params?: AppNavigationParams) => void = () => undefined;
let activeRefreshOverview = () => undefined;
let globalEventsInstalled = false;
let levelSetupChecked = false;
let syncConflictNotice = '';

function installGlobalEvents() {
  if (globalEventsInstalled || typeof window === 'undefined') return;
  globalEventsInstalled = true;
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
const grammarPages = new Set<Page>(['grammar', 'detail', 'grammar-foundation', 'favorites']);
const protectedPages = new Set<Page>(['account', 'personal-info', 'team']);
const proPages: Partial<Record<Page, FeatureId>> = { 'distinction-quiz': 'confusionGroups' };

export function WeappPage({ page, Route }: { page: Page; Route: ComponentType }) {
  const route = ROUTE_TABLE.find((item) => item.page === page)!;
  const portalHost = usePortalHost();
  const state = useAppState();
  const studyStore = useStudyStore();
  const entitlements = useEntitlements();
  const ui = useSyncExternalStore(subscribeUiState, getUiState, getUiState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [skin, setSkin] = useState('');
  const [overview, setOverview] = useState(() => ({ words: { total: 0, seen: 0, completed: 0, low: 0, unseen: 0 }, wordsByLevel: [], grammar: [] }));
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });

  useEffect(() => {
    let cancelled = false;
    ensureDatabase()
      .then(() => Promise.all([
        readyForKanji(),
        grammarPages.has(page) ? readyForGrammar() : undefined
      ]))
      .then(async () => {
        if (cancelled) return;
        setOverview(getProgressOverview());
        setTheme(getResolvedTheme());
        setSkin(equippedItem('theme'));
        setCloudSession(await getCloudSession());
        if (cancelled) return;
        setReady(true);
        if (!levelSetupChecked) {
          levelSetupChecked = true;
          try { setLevelSetupOpen(shouldShowLevelSetup()); } catch { /* 旧库可能尚无计划设置 */ }
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause?.message || cause?.errMsg || JSON.stringify(cause)));
      });
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    const refreshTheme = () => {
      setTheme(getResolvedTheme());
      try { setSkin(equippedItem('theme')); } catch { /* database is still opening */ }
    };
    window.addEventListener(PREFERENCES_EVENT, refreshTheme);
    window.addEventListener(YUZU_EVENT, refreshTheme);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, refreshTheme);
      window.removeEventListener(YUZU_EVENT, refreshTheme);
    };
  }, []);

  const navigatePage = (target: Page, params?: AppNavigationParams, authenticated = false) => {
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

    const current = getAppState();
    const { studyMode, ...routeParams } = params ?? {};
    const patch: Partial<AppState> = { ...routeParams };
    if (target === 'word') {
      const mode = studyMode ?? getStudyMode() ?? defaultStudyMode;
      patch.selectedStudyMode = mode;
      patch.launchStudyMode = mode;
      patch.wordStudyRevision = current.wordStudyRevision + 1;
    }
    if (target === 'home' || target === 'study-modes') {
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
    activeNavigate = (target, params) => navigatePage(target, params);
    activeRefreshOverview = () => { try { setOverview(getProgressOverview()); } catch { /* database opening */ } };
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
    closePaywall,
    closeAuth: () => { closeAuth(); setAppState({ pendingAccountPage: null }); },
    handleAuthenticated: async (session) => {
      setCloudSession(session);
      try { await syncUserProfileAfterLogin(session); }
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
  if (error) return <View className="theme-light p-4"><Text>{error}</Text></View>;
  if (!ready) return <View className="theme-light p-4"><Text>正在载入学习数据…</Text></View>;

  return (
    <AppShell
      context={context}
      className={`app-shell relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#FFFBF2] via-[#FDF1DC] to-[#F6E9D2] text-[#3A2E22]${page === 'weekly-report' ? ' is-weekly-report' : ''}`}
      achievementPop={ui.achievementPop}
      notice={ui.notice}
      paywallTarget={ui.paywallTarget}
      authOpen={ui.authOpen}
      levelSetupOpen={ui.levelSetupOpen}
      trialEndedOpen={ui.trialEndedOpen}
      onAuthenticated={(session: CloudSession) => context.handleAuthenticated(session)}
      onClosePaywall={closePaywall}
      onCloseAuth={context.closeAuth}
      onLevelSetupComplete={(message) => {
        setLevelSetupOpen(false);
        showNotice(message, 5200);
        navigatePage('jlpt-plan');
      }}
      onDismissTrial={() => { markTrialNoticeRead(); setTrialEndedOpen(false); }}
      onViewPro={() => { markTrialNoticeRead(); setTrialEndedOpen(false); navigatePage('pro'); }}
    >
      <View ref={portalHost} className={`weapp-route-root theme-${theme}${skin ? ` skin-${skin}` : ''}`}>
        <View className="app-landscape-main min-w-0 px-4 pb-8 pt-4">
          <Suspense fallback={<View className="theme-light p-4"><Text>正在加载…</Text></View>}>
            <Route />
          </Suspense>
        </View>
      </View>
    </AppShell>
  );
}
