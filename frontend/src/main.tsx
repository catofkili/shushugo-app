import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initDatabase } from './lib/database';
import { loadDatabase, registerPersistenceLifecycle } from './lib/storage';
import { ensureSeedData } from './lib/study-core';
import { initWebViewOptimizer } from './lib/webview-optimizer';
import { applyTheme } from './lib/studyPreferences';
import { ErrorBoundary } from './components/ErrorBoundary';
import { autoSyncReminderNotifications } from './lib/notifications';

// 初始化 WebView 优化
initWebViewOptimizer();

// 【诊断】量一下安全区到底有没有生效(打到 Xcode 控制台)
(() => {
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
})();

// 立即应用主题（在渲染前）
applyTheme();

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
    <div className="grid min-h-screen place-items-center bg-[#555858] px-6 text-center text-[#fff]">
      <div>
        <p className="jp-serif text-4xl font-semibold">語</p>
        <p className="mt-3 text-sm font-semibold text-white/70">正在读取本地词库...</p>
      </div>
    </div>
  </StrictMode>
);

(async () => {
    // 有本地存档就直接用,跳过 6.5MB 出厂词库的 fetch + 解析;
    // 没有(首次启动/存档损坏)才加载出厂库。
    const restored = await loadDatabase();
    if (!restored) {
      await initDatabase();
    }
    await ensureSeedData();
    registerPersistenceLifecycle();
    autoSyncReminderNotifications().catch((error) => {
      console.warn('Notification reminder sync skipped:', error);
    });
    console.log('✅ Database ready');
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );
  })()
  .catch((error) => {
    console.error('❌ Failed to initialize database:', error);
    root.render(
      <StrictMode>
        <div className="grid min-h-screen place-items-center bg-[#555858] px-6 text-center text-[#fff]">
          <div>
            <p className="text-xl font-bold">本地词库读取失败</p>
            <p className="mt-3 text-sm text-white/70">请检查应用内是否包含 nihongo.db 和 sql-wasm.wasm。</p>
          </div>
        </div>
      </StrictMode>
    );
  });
