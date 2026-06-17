import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initDatabase } from './lib/database';
import { loadDatabase } from './lib/storage';
import { initWebViewOptimizer } from './lib/webview-optimizer';
import { applyTheme } from './lib/studyPreferences';

// 初始化 WebView 优化
initWebViewOptimizer();

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

initDatabase()
  .then(async () => {
    await loadDatabase();
    console.log('✅ Database ready');
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  })
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
