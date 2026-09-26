const path = require('node:path');
const fs = require('node:fs');
const webpack = require('webpack');
const { UnifiedWebpackPluginV5 } = require('weapp-tailwindcss/webpack');
const { createSharedShims } = require('../../wechat-miniprogram/scripts/shared/shims-map.mjs');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const frontend = path.join(repoRoot, 'frontend');
const mini = path.join(repoRoot, 'wechat-miniprogram');
const shims = createSharedShims(mini);
const weappEnv = require(path.join(root, 'src/platform/weapp-env.weapp.cjs'));
const platformAdapters = new Map([
  ['frontend/src/lib/haptics', path.join(frontend, 'src/lib/haptics.weapp.ts')],
  ['frontend/src/lib/notifications', path.join(frontend, 'src/lib/notifications.weapp.ts')],
  ['frontend/src/lib/speech', path.join(frontend, 'src/lib/speech.weapp.ts')],
  ['frontend/src/lib/share-image', path.join(frontend, 'src/lib/share-image.weapp.ts')],
  ['frontend/src/lib/share-canvas', path.join(frontend, 'src/lib/share-canvas.weapp.ts')],
  ['frontend/src/lib/cloud-fetch', path.join(root, 'src/platform/fetch.weapp.cjs')],
  ['frontend/src/lib/purchases', path.join(frontend, 'src/lib/purchases.weapp.ts')],
  ['frontend/src/lib/apple-auth', path.join(frontend, 'src/lib/apple-auth.weapp.ts')],
  ['frontend/src/components/AuthDialog', path.join(frontend, 'src/components/AuthDialog.weapp.tsx')],
  ['frontend/src/components/Paywall', path.join(frontend, 'src/components/Paywall.weapp.tsx')],
  ['frontend/src/components/ShareImageSheet', path.join(frontend, 'src/components/ShareImageSheet.weapp.tsx')],
  ['frontend/src/pages/NotificationSettings', path.join(frontend, 'src/pages/NotificationSettings.weapp.tsx')],
  ['wechat-miniprogram/src/runtime/auth', path.join(root, 'src/platform/payment-auth.weapp.cjs')]
].map(([target, replacement]) => [path.join(repoRoot, target), replacement]));
const previewTimingEnabled = process.env.TARO_PREVIEW_TIMING === '1';

module.exports = {
  projectName: 'shushugo-taro-spike-2',
  date: '2026-09-25',
  designWidth: 375,
  deviceRatio: { 375: 2, 750: 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  copy: {
    patterns: [
      { from: path.join(root, 'assets/sql-wasm.wasm.br'), to: path.join(root, 'dist/assets/sql-wasm.wasm.br') },
      { from: path.join(mini, 'src/vendor/fflate.umd.js'), to: path.join(root, 'dist/account/fflate.umd.js') },
      { from: path.join(mini, 'src/content/question-meanings.js'), to: path.join(root, 'dist/content/question-meanings.js') },
      { from: path.join(mini, 'src/content/kanji-unit-runtime.js'), to: path.join(root, 'dist/content/kanji-unit-runtime.js') },
      { from: path.join(mini, 'src/content/kanji-reading-usage.js'), to: path.join(root, 'dist/content/kanji-reading-usage.js') },
      { from: path.join(mini, 'src/content/pitch-accent.js'), to: path.join(root, 'dist/content/pitch-accent.js') },
      { from: path.join(mini, 'src/features/content/distinction-reviews.js'), to: path.join(root, 'dist/features/content/distinction-reviews.js') },
      { from: path.join(mini, 'src/features/content/kanji-variants.js'), to: path.join(root, 'dist/features/content/kanji-variants.js') },
      { from: path.join(mini, 'src/features/content/kanji-readings.js'), to: path.join(root, 'dist/features/content/kanji-readings.js') },
      { from: path.join(mini, 'src/features/content/grammar-key-points.js'), to: path.join(root, 'dist/features/content/grammar-key-points.js') },
      { from: path.join(root, 'src/assets'), to: path.join(root, 'dist/assets') }
    ],
    options: {}
  },
  plugins: ['@tarojs/plugin-html'],
  framework: 'react',
  compiler: 'webpack5',
  alias: {
    'lucide-react': path.join(root, 'src/platform/lucide.weapp.tsx'),
    'sql.js$': path.join(root, 'src/platform/sql-js.weapp.cjs'),
    react: path.join(root, 'node_modules/react'),
    'react/jsx-runtime': path.join(root, 'node_modules/react/jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(root, 'node_modules/react/jsx-dev-runtime.js')
  },
  mini: {
    optimizeMainPackage: {
      enable: true,
      exclude: [(module) => /(?:frontend\/src\/lib\/|node_modules\/ts-fsrs\/|wechat-miniprogram\/src\/(?:vendor\/sql-wasm\.js|runtime\/text-decoder\.js)$|taro-spike-2\/src\/platform\/(?:database-runtime\.weapp\.ts|sql-js\.weapp\.cjs|sql-wasm-url\.weapp\.cjs|entitlements\.weapp\.cjs)$)/.test(module.resource || '')]
    },
    compile: { include: [frontend, mini] },
    cssLoaderOption: { url: { filter: (url) => !url.startsWith('/') } },
    postcss: {
      pxtransform: { enable: true, config: {} },
      htmltransform: { enable: true, config: { removeCursorStyle: true } },
      [path.join(root, 'scripts/weapp-theme-selectors.cjs')]: {},
      [path.join(root, 'scripts/strip-weapp-css.cjs')]: {}
    },
    webpackChain(chain, webpack) {
      chain.resolve.modules.add(path.join(root, 'node_modules'));
      chain.resolve.modules.add(path.join(frontend, 'node_modules'));
      chain.resolve.alias.set('worker_threads$', path.join(root, 'src/platform/worker-threads.weapp.cjs'));
      chain.module.rule('sql-source').test(/\.sql$/).type('asset/source');
      chain.plugin('spike-node-crypto').use(webpack.NormalModuleReplacementPlugin, [
        /^node:crypto$/,
        path.join(root, 'scripts/node-crypto-stub.cjs')
      ]);
      chain.plugin('spike-node-fs').use(webpack.NormalModuleReplacementPlugin, [
        /^node:fs$/,
        path.join(root, 'scripts/node-fs-stub.cjs')
      ]);
      if (!previewTimingEnabled) {
        chain.plugin('preview-timing-off').use(webpack.NormalModuleReplacementPlugin, [
          /preview-timing\.weapp$/,
          path.join(root, 'src/platform/preview-timing-off.weapp.tsx')
        ]);
      } else {
        // React disables Profiler callbacks in its normal production reconciler.
        // The preview-only measurement layer needs the matching profiling build.
        chain.resolve.alias.set(
          'react-reconciler$',
          path.join(root, 'node_modules/react-reconciler/cjs/react-reconciler.profiling.min.js')
        );
      }
      chain.plugin('spike-weapp-env').use(webpack.DefinePlugin, [{
        'import.meta.env': JSON.stringify(weappEnv)
      }]);
      chain.plugin('shushugo-shared-shims').use(webpack.NormalModuleReplacementPlugin, [
        /.*/,
        (resource) => {
          if (resource.request === 'sql.js/dist/sql-wasm.wasm?url') {
            resource.request = path.join(root, 'src/platform/sql-wasm-url.weapp.cjs');
            return;
          }
          if (/(^|\/)TokenDictionaryPopover(?:\.[^/]*)?$/.test(resource.request)) {
            // The web source imports react-dom/createPortal at TokenDictionaryPopover.tsx:3
            // and targets document.body at :148-199; WeChat has no DOM portal target.
            resource.request = path.join(frontend, 'src/components/TokenDictionaryPopover.weapp.tsx');
            return;
          }
          if (/(^|\/)JapaneseRubyText(?:\.[^/]*)?$/.test(resource.request)) {
            resource.request = path.join(frontend, 'src/components/JapaneseRubyText.weapp.tsx');
            return;
          }
          if (/^(@capacitor\/|@capacitor-community\/|@aparajita\/)/.test(resource.request)) {
            if (resource.request === '@capacitor/core') {
              resource.request = path.join(root, 'src/platform/capacitor-core.weapp.cjs');
              return;
            }
            if (resource.request === '@capacitor/filesystem') {
              resource.request = path.join(root, 'src/platform/filesystem.weapp.cjs');
              return;
            }
            if (resource.request === '@capacitor/preferences') {
              resource.request = path.join(root, 'src/platform/preferences.weapp.cjs');
              return;
            }
            resource.request = path.join(root, 'scripts/native-stubs.cjs');
            return;
          }
          if (!resource.context || !resource.request.startsWith('.')) return;
          const fromShim = resource.context.startsWith(path.join(mini, 'scripts/shared/shims'));
          const target = path.resolve(fromShim ? path.join(mini, 'src/shared') : resource.context, resource.request)
            .replace(/\.(tsx?|jsx?|js|json)$/, '')
            .replace(/\?raw$/, '');
          if (target === path.join(mini, 'src/config')) {
            resource.request = path.join(root, 'src/platform/config.weapp.cjs');
            return;
          }
          const adapter = platformAdapters.get(target);
          if (adapter) {
            resource.request = adapter;
            return;
          }
          if (target === path.join(mini, 'src/shared/content')) {
            resource.request = path.join(root, 'scripts/taro-content.cjs');
            return;
          }
          if (target === path.join(mini, 'src/runtime/entitlements')) {
            resource.request = path.join(root, 'src/platform/entitlements.weapp.cjs');
            return;
          }
          if (target === path.join(frontend, 'src/data/grammar')) {
            resource.request = path.join(root, 'src/platform/grammar-data.weapp.cjs');
            return;
          }
          // Route all frontend modules through the same live DB and durable file storage.
          if (target === path.join(frontend, 'src/lib/database') || target === path.join(frontend, 'src/lib/storage')) return;
          if (target === path.join(frontend, 'src/components/CapybaraMascot')) {
            resource.request = path.join(root, 'src/platform/mascot.weapp.tsx');
            return;
          }
          const replacement = shims.get(target);
          if (replacement) resource.request = replacement;
          else if (fromShim && fs.existsSync(`${target}.js`)) resource.request = `${target}.js`;
        }
      ]);
      chain.plugin('weapp-tailwindcss').use(UnifiedWebpackPluginV5, [{ rem2rpx: true }]);
      chain.plugin('spike-webpack-stats').use(class {
        apply(compiler) {
          compiler.hooks.done.tap('TaroSpikeStats', (stats) => {
            const output = path.join(root, 'reports/webpack-stats.json');
            fs.mkdirSync(path.dirname(output), { recursive: true });
            fs.writeFileSync(output, JSON.stringify(stats.toJson({
              all: false, assets: true, chunks: true, entrypoints: true,
              modules: true, chunkModules: true, source: false
            }), null, 2));
          });
        }
      });
    }
  }
};
