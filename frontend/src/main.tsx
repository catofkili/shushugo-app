import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './app.css';
import './skins.css'; // 风格主题（纸本 / 圆圆）必须排在 app.css 之后，见 skins.css 开头
import { initDatabase } from './lib/database';
import { LocalArchiveUnreadableError, loadDatabase, registerPersistenceLifecycle } from './lib/storage';
import { Sticker } from './components/CapybaraMascot';
import { ensureSeedData } from './lib/study-core';
import { applyYuzuEquipment } from './lib/yuzu';
import { initWebViewOptimizer } from './lib/webview-optimizer';
import { applyMotionLevel, applyTheme, ensureJlptPlanAnchor, getStudyPreferences } from './lib/studyPreferences';
import { ErrorBoundary } from './components/ErrorBoundary';
import { autoSyncReminderNotifications, autoSyncWeeklyReportNotification, loadReminderSettings, registerNotificationActionListener, syncWeeklyReportNotification } from './lib/notifications';
import { syncJlptPlanReminders } from './lib/jlpt/reminders';
import { initializePurchases, retryPendingPurchaseVerifications } from './lib/purchases';
import { autoSyncCloudDatabase, CLOUD_AUTH_EVENT, registerCloudAutoSyncLifecycle, refreshCloudEntitlements } from './lib/sync-api';
import { ensureSyncSchema } from './lib/sync/schema';
import { flushPendingUserProfileSync } from './lib/profile-sync';
import { hydrateLevelPlanPreferences } from './lib/level-plan';

// 初始化 WebView 优化
initWebViewOptimizer();

// 【诊断】量一下安全区到底有没有生效(打到 Xcode 控制台);只在开发构建运行。
if (import.meta.env.DEV) {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;height:env(safe-area-inset-top);width:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  requestAnimationFrame(() => {
    const top = probe.getBoundingClientRect().height;
    const bottom = probe.getBoundingClientRect().width;
    console.log(
      `[safe-area] top=${top}px bottom=${bottom}px | innerH=${window.innerHeight} screenH=${window.screen.height} | viewport-fit=cover`
    );
    probe.remove();
  });
}

// 立即应用主题与动效档位（在渲染前，避免首帧闪一下满血动画）
applyTheme();
applyMotionLevel();

// 监听系统主题变化
if (window.matchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkModeQuery.addEventListener('change', () => {
    applyTheme();
  });
}

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <div className="app-boot-loading grid min-h-screen place-items-center overflow-y-auto bg-[#555858] px-6 text-center text-[#fff]">
      <div>
        <Sticker name="splash-sleep" size={130} className="mx-auto" />
        <Sticker name="logo-lockup" size={72} className="mx-auto mt-1" alt="收集日" />
        <p className="mt-3 text-sm font-semibold text-white/70">正在读取本地词库...</p>
        <p className="mt-1 text-xs text-white/45">小小的积累，也会成为巨大的改变。</p>
      </div>
    </div>
  </StrictMode>
);

/**
 * 存档打不开时的启动画面。
 *
 * ⚠️ 这一档不许自动往下走。以前「没有存档」和「有存档但打不开」都是 false,
 * 于是后者会静默加载出厂库 —— 用户看到一份崭新的空库,而下一次落盘就把那份
 * 可能只是暂时读不出来的存档盖掉了。重建必须是用户自己点的。
 */
const renderArchiveRecovery = (error: LocalArchiveUnreadableError) => {
  const downloadArchive = () => {
    if (!error.archive) return;
    const url = URL.createObjectURL(new Blob([error.archive.slice().buffer as ArrayBuffer]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `shushugo-unreadable-${new Date().toISOString().slice(0, 10)}.db`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const rebuild = () => {
    if (!error.archive || !window.confirm('请先导出并保管这份存档。重建后这台设备会从出厂词库重新开始，旧进度不会自动恢复。确定吗？')) return;
    void initDatabase().then(bootWithDatabase).catch((cause) => renderBootFailure(cause));
  };
  const button = 'focus-ring rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white/85';
  root.render(
    <StrictMode>
      <div className="app-boot-loading grid min-h-screen place-items-center overflow-y-auto bg-[#555858] px-6 py-10 text-center text-[#fff]">
        <div className="max-w-md">
          <Sticker name="empty-network" size={96} className="mx-auto mb-3" />
          <p className="text-xl font-bold">本地学习存档打不开</p>
          <p className="mt-3 text-sm leading-6 text-white/70">
            这份存档已原样保留，没有被覆盖。可能只是这次读取失败，先重试一下；
            仍然不行的话把它导出来再重建。
          </p>
          <p className="mt-2 text-xs text-white/45">{String((error.reason as Error)?.message ?? error.reason ?? '')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className={button} onClick={() => window.location.reload()}>重试</button>
            {error.archive
              ? <button className={button} onClick={downloadArchive}>导出这份存档</button>
              : <span className="self-center text-xs text-white/45">未能取得可导出的存档，请先重试或联系支持，保留本机数据。</span>}
            {error.archive && <button className={button} onClick={rebuild}>重建为出厂库</button>}
          </div>
        </div>
      </div>
    </StrictMode>
  );
};

const renderBootFailure = (error: unknown) => {
  console.error('❌ Failed to initialize database:', error);
  root.render(
    <StrictMode>
      <div className="app-boot-loading grid min-h-screen place-items-center overflow-y-auto bg-[#555858] px-6 text-center text-[#fff]">
        <div>
          <Sticker name="empty-network" size={96} className="mx-auto mb-3" />
          <p className="text-xl font-bold">本地词库读取失败</p>
          <p className="mt-3 text-sm text-white/70">请检查应用内是否包含 nihongo.db 和 sql-wasm.wasm。</p>
        </div>
      </div>
    </StrictMode>
  );
};

async function bootWithDatabase() {
    await ensureSeedData();
    ensureSyncSchema();
    hydrateLevelPlanPreferences();
    applyYuzuEquipment();
    ensureJlptPlanAnchor();
    registerPersistenceLifecycle();
    registerCloudAutoSyncLifecycle();
    console.log('✅ Database ready');
    void registerNotificationActionListener().catch((error) => {
      console.warn('Notification action listener skipped:', error);
    });
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );

    // 离线优先:先显示本地数据库,网络同步在后台进行。同步失败不能伪装成
    // “本地词库读取失败”,同步完成后会通过事件让 App 刷新进度。
    autoSyncCloudDatabase('startup').catch((error) => {
      console.warn('Cloud startup sync skipped:', error);
    });
    autoSyncReminderNotifications().catch((error) => {
      console.warn('Notification reminder sync skipped:', error);
    });
    // 关掉「每周学习回顾」时不再排期，同时也把上一次留下的待发通知清掉。
    if (getStudyPreferences().weeklyReportEnabled) {
      autoSyncWeeklyReportNotification().catch((error) => {
        console.warn('Weekly report notification sync skipped:', error);
      });
    } else {
      void loadReminderSettings()
        .then((settings) => syncWeeklyReportNotification({ ...settings, weeklyReportReminder: false }))
        .catch((error) => console.warn('Weekly report notification cancel skipped:', error));
    }
    // 备考提醒的正文每天都不一样(倒计时 + 今天还差多少),没法用一条 repeats 通知糊过去,
    // 所以每次启动重排未来两周。放在数据库 ready 之后:算最低量要查库。
    syncJlptPlanReminders().catch((error) => {
      console.warn('JLPT plan reminder sync skipped:', error);
    });
    // 已登录云账号的话,后台静默刷新 Pro 权益(订阅在别的设备续订/取消后保持一致);
    // 未登录或未配置同步地址时内部直接返回,不产生请求。
    refreshCloudEntitlements().catch((error) => {
      console.warn('Cloud entitlement refresh skipped:', error);
    });
    flushPendingUserProfileSync().catch((error) => {
      console.warn('Profile sync skipped:', error);
    });
    window.addEventListener('online', () => {
      void flushPendingUserProfileSync().catch((error) => console.warn('Profile sync retry skipped:', error));
    });
    // 启动时就初始化 StoreKit:订阅续订/退款要靠 verified 回调更新本地权益,
    // 不能等用户打开 Paywall 才生效。非 iOS 环境内部直接返回。
    initializePurchases().catch((error) => {
      console.warn('StoreKit init skipped:', error);
    });
    // 登录之前买过、或者买的时候云端不通的交易,登录成功后补一次校验。
    window.addEventListener(CLOUD_AUTH_EVENT, () => {
      void retryPendingPurchaseVerifications().catch((error) => {
        console.warn('Pending purchase verification retry skipped:', error);
      });
    });
}

(async () => {
  // 有本地存档就直接用,跳过 6.5MB 出厂词库的 fetch + 解析;
  // 只有「确实没有存档」(首次启动)才加载出厂库 —— 「打不开」走恢复画面。
  let restored = false;
  try {
    restored = await loadDatabase();
  } catch (error) {
    if (error instanceof LocalArchiveUnreadableError) {
      renderArchiveRecovery(error);
      return;
    }
    throw error;
  }
  if (!restored) await initDatabase();
  await bootWithDatabase();
})().catch(renderBootFailure);
