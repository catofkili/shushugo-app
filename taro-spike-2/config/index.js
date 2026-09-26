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
// progress-events 用网页原版：它的裸 window 在 Taro 里是 TaroWindow（app-polyfills 补了 dispatchEvent），页面的监听器挂在那上面。
// 原生小程序那份垫片派发到 globalThis.window——Taro 页面听不到，而且缺 withProgressEventsMuted：
// 「预算下一张」在小程序里每次都抛 TypeError、全部退回同步路径（2026-09-26 W10 真机对比时查出）。
shims.delete(path.join(frontend, 'src/lib/progress-events'));
const weappEnv = require(path.join(root, 'src/platform/weapp-env.weapp.cjs'));
const platformAdapters = new Map([
  ['frontend/src/lib/haptics', path.join(frontend, 'src/lib/haptics.weapp.ts')],
  ['frontend/src/lib/notifications', path.join(frontend, 'src/lib/notifications.weapp.ts')],
  ['frontend/src/lib/speech', path.join(frontend, 'src/lib/speech.weapp.ts')],
  ['frontend/src/lib/share-image', path.join(frontend, 'src/lib/share-image.weapp.ts')],
  ['frontend/src/lib/share-canvas', path.join(frontend, 'src/lib/share-canvas.weapp.ts')],
  ['frontend/src/lib/platform-dialogs', path.join(root, 'src/platform/platform-dialogs.weapp.ts')],
  ['frontend/src/lib/share-text', path.join(root, 'src/platform/share-text.weapp.ts')],
  ['frontend/src/lib/cloud-fetch', path.join(root, 'src/platform/fetch.weapp.cjs')],
  ['frontend/src/lib/purchases', path.join(frontend, 'src/lib/purchases.weapp.ts')],
  ['frontend/src/lib/apple-auth', path.join(frontend, 'src/lib/apple-auth.weapp.ts')],
  ['frontend/src/lib/touch-adapter', path.join(root, 'src/platform/touch-adapter.weapp.ts')],
  ['frontend/src/components/AuthDialog', path.join(frontend, 'src/components/AuthDialog.weapp.tsx')],
  ['frontend/src/components/ShareImageSheet', path.join(frontend, 'src/components/ShareImageSheet.weapp.tsx')],
  ['frontend/src/components/DailyPlanSlider', path.join(frontend, 'src/components/DailyPlanSlider.weapp.tsx')],
  ['frontend/src/components/DailyPlanRing', path.join(frontend, 'src/components/DailyPlanRing.weapp.tsx')],
  ['frontend/src/components/GrammarTermHint', path.join(frontend, 'src/components/GrammarTermHint.weapp.tsx')],
  ['frontend/src/pages/NotificationSettings', path.join(frontend, 'src/pages/NotificationSettings.weapp.tsx')],
  ['wechat-miniprogram/src/runtime/auth', path.join(root, 'src/platform/payment-auth.weapp.cjs')]
].map(([target, replacement]) => [path.join(repoRoot, target), replacement]));
const previewTimingEnabled = process.env.TARO_PREVIEW_TIMING === '1';
// 分段计时浮层（PerfOverlay）但 React 用正式版：量真机体验用。计时版的性能分析版 React 本身就慢，会把「点击到换卡」量大。
// 和计时版一样只许出预览码，check:release 会拦（产物里带 preview-timing 模块）。
const perfOverlayEnabled = process.env.TARO_PERF_OVERLAY === '1';

module.exports = {
  projectName: 'shushugo-taro-spike-2',
  date: '2026-09-25',
  designWidth: 375,
  deviceRatio: { 375: 2, 750: 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  copy: {
    patterns: [
      { from: path.join(root, 'assets/sql-wasm.wasm.br'), to: path.join(root, 'dist/core/sql-wasm.wasm.br') },
      { from: path.join(mini, 'src/vendor/fflate.umd.js'), to: path.join(root, 'dist/account/fflate.umd.js') },
      { from: path.join(mini, 'src/content/question-meanings.js'), to: path.join(root, 'dist/content/question-meanings.js') },
      { from: path.join(mini, 'src/content/kanji-unit-runtime.js'), to: path.join(root, 'dist/content/kanji-unit-runtime.js') },
      { from: path.join(mini, 'src/content/kanji-reading-usage.js'), to: path.join(root, 'dist/content/kanji-reading-usage.js') },
      { from: path.join(mini, 'src/content/pitch-accent.js'), to: path.join(root, 'dist/content/pitch-accent.js') },
      { from: path.join(mini, 'src/features/content/distinction-reviews.js'), to: path.join(root, 'dist/features/content/distinction-reviews.js') },
      { from: path.join(mini, 'src/features/content/kanji-variants.js'), to: path.join(root, 'dist/features/content/kanji-variants.js') },
      { from: path.join(mini, 'src/features/content/kanji-readings.js'), to: path.join(root, 'dist/features/content/kanji-readings.js') },
      { from: path.join(mini, 'src/features/content/grammar-key-points.js'), to: path.join(root, 'dist/features/content/grammar-key-points.js') },
      { from: path.join(root, 'src/assets'), to: path.join(root, 'dist/assets') },
      ...['study', 'account', 'content-pages'].map((subpackage) => ({
        from: path.join(root, 'src/package-assets', subpackage),
        to: path.join(root, 'dist', subpackage, 'assets')
      }))
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
      // Let route-only data helpers move with their subpackage. Keep the DB,
      // FSRS and native shims together because the tab pages also use them.
      exclude: [(module) => /(?:node_modules\/ts-fsrs\/|wechat-miniprogram\/src\/(?:vendor\/sql-wasm\.js|runtime\/text-decoder\.js)$|taro-spike-2\/src\/platform\/(?:database-runtime\.weapp\.ts|sql-js\.weapp\.cjs|sql-wasm-url\.weapp\.cjs|entitlements\.weapp\.cjs)$)/.test(module.resource || '')]
    },
    compile: { include: [frontend, mini] },
    imageUrlLoaderOption: { limit: 1 },
    cssLoaderOption: {
      url: {
        filter: (url) => !url.startsWith('/') && !/walk-strip\.webp(?:[?#].*)?$/.test(url)
      }
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      htmltransform: { enable: true, config: { removeCursorStyle: true } },
      [path.join(root, 'scripts/weapp-theme-selectors.cjs')]: {},
      [path.join(root, 'scripts/strip-weapp-css.cjs')]: {}
    },
    webpackChain(chain, webpack) {
      // import() 出来的异步代码块：文件名由 webpackChunkName 决定（'lazy/xxx' → 落进 lazy 分包），
      // 运行时用微信官方的分包异步化 require.async 加载，替掉 webpack 默认的 <script> 加载。
      chain.output.chunkFilename('[name].js');
      // 其余的 import() 一律按「立即加载」处理（和原来 babel 把它转成 require 的效果一样），
      // 只有写了 /* webpackMode: "lazy" */ 的才生成异步块——否则语法数据等上百个 import() 全变成主包根目录的异步块。
      chain.module.set('parser', { ...(chain.module.get('parser') || {}), javascript: { dynamicImportMode: 'eager' } });
      // Taro 的 common / vendors / taro 三组默认 chunks: 'all'，会想把异步块里的模块提进主包 common，
      // 和异步块的加载关系冲突（SplitChunksPlugin: Cache group "common" conflicts with existing chunk）。
      // 只让它们管初始代码块；异步块里的模块本来就会跳过父级已有的，剩下的就该留在异步块里。
      chain.optimization.merge({ splitChunks: { chunks: 'initial' } });
      for (const group of ['common', 'vendors', 'taro']) {
        const cacheGroups = chain.optimization.get('splitChunks')?.cacheGroups;
        if (cacheGroups?.[group]) cacheGroups[group].chunks = 'initial';
      }
      chain.plugin('wx-require-async-chunks').use(class WxRequireAsyncChunkLoading {
        apply(compiler) {
          const { RuntimeGlobals, RuntimeModule, Template } = compiler.webpack;
          class LoadScript extends RuntimeModule {
            constructor() { super('wx require.async chunk loading', RuntimeModule.STAGE_ATTACH); }
            generate() {
              // ⚠️ require.async 的参数必须是字符串字面量：开发者工具 / 上传时靠静态分析它决定哪些文件进包，
              // 拼出来的路径（'./' + url）会被当成无用文件不注入，运行时 ChunkLoadError。所以按异步块逐个写死。
              const { compilation } = this;
              const files = [...compilation.chunks]
                .filter((chunk) => !chunk.canBeInitial())
                .map((chunk) => compilation.getPath(compilation.outputOptions.chunkFilename, { chunk, contentHashType: 'javascript' }));
              return Template.asString([
                'var loaders = {',
                Template.indent(files.map((file) => `${JSON.stringify(file)}: function () { return require.async(${JSON.stringify(`./${file}`)}); },`)),
                '};',
                `${RuntimeGlobals.loadScript} = function (url, done) {`,
                Template.indent([
                  "var load = loaders[String(url).replace(/^\\/+/, '')];",
                  "if (!load) { console.error('[lazy chunk] unknown', url); done({ type: 'error', target: { src: url } }); return; }",
                  'load().then(',
                  "  function () { done({ type: 'load', target: { src: url } }); },",
                  "  function (error) { console.error('[lazy chunk]', url, error && (error.errMsg || error.message) || error); done({ type: 'error', target: { src: url } }); }",
                  ');'
                ]),
                '};'
              ]);
            }
          }
          compiler.hooks.thisCompilation.tap('WxRequireAsyncChunkLoading', (compilation) => {
            compilation.hooks.runtimeRequirementInTree.for(RuntimeGlobals.loadScript).tap('WxRequireAsyncChunkLoading', (chunk) => {
              compilation.addRuntimeModule(chunk, new LoadScript());
            });
          });
        }
      });
      chain.resolve.modules.add(path.join(root, 'node_modules'));
      chain.resolve.modules.add(path.join(frontend, 'node_modules'));
      chain.plugin('spike-local-storage').use(webpack.ProvidePlugin, [{
        localStorage: path.join(root, 'src/platform/local-storage.weapp.cjs')
      }]);
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
        if (!perfOverlayEnabled) chain.plugin('preview-timing-off').use(webpack.NormalModuleReplacementPlugin, [
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
      // ⚠️ 必须按键逐个定义。只定义 'import.meta.env' 一个对象字符串时，webpack 建模块图那一刻
      // 看到的是 `({…}).DEV`，判断不出它恒为 false，于是 `if (import.meta.env.DEV) import('./dev-snapshot')`
      // 这种开发专用模块照样进包（运行时走不到，但白占主包）；Vite 是直接替换成 false 的，网页版没有这个问题。
      chain.plugin('spike-weapp-env').use(webpack.DefinePlugin, [{
        'import.meta.env': JSON.stringify(weappEnv),
        ...Object.fromEntries(Object.entries(weappEnv).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
        // Bind browser globals explicitly to the app-polyfills shims in the WeChat bundle.
        Blob: 'globalThis.Blob',
        FileReader: 'globalThis.FileReader',
        ResizeObserver: 'globalThis.ResizeObserver',
        performance: 'globalThis.performance',
        // 网页在 vite.config.ts 里 define 的常量，这里要同名补上，否则用到它的页面（关于）渲染时 ReferenceError 整页空白。
        __APP_VERSION__: JSON.stringify(require(path.join(frontend, 'package.json')).version)
      }]);
      chain.plugin('shushugo-shared-shims').use(webpack.NormalModuleReplacementPlugin, [
        /.*/,
        (resource) => {
          if (resource.request === 'react-dom' && !resource.contextInfo?.issuer?.endsWith('react-dom.weapp.ts')) {
            // 网页的 createPortal(弹层, document.body) 在小程序里看不见，见 src/platform/portal-host.weapp.ts。
            // 用模块替换而不是 alias：Taro 的 React 插件自己把 react-dom$ 别名到 @tarojs/react，替换在别名之前生效。
            resource.request = path.join(root, 'src/platform/react-dom.weapp.ts');
            return;
          }
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
          if (/(^|\/)FloatingDoodlePen(?:\.[^/]*)?$/.test(resource.request)) {
            resource.request = path.join(frontend, 'src/components/FloatingDoodlePen.weapp.tsx');
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
              modules: true, chunkModules: true, nestedModules: true,
              orphanModules: true, dependentModules: true, runtimeModules: true,
              modulesSpace: 1000, nestedModulesSpace: 1000, source: false
            }), null, 2));
          });
        }
      });
    }
  }
};
