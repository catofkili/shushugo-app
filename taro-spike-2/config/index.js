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

module.exports = {
  projectName: 'shushugo-taro-spike-2',
  date: '2026-09-25',
  designWidth: 375,
  deviceRatio: { 375: 2, 750: 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  copy: {
    patterns: [{ from: path.join(mini, 'src/assets/sql-wasm.wasm'), to: path.join(root, 'dist/assets/sql-wasm.wasm') }],
    options: {}
  },
  plugins: ['@tarojs/plugin-html'],
  framework: 'react',
  compiler: 'webpack5',
  alias: {
    react: path.join(root, 'node_modules/react'),
    'react/jsx-runtime': path.join(root, 'node_modules/react/jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(root, 'node_modules/react/jsx-dev-runtime.js')
  },
  mini: {
    compile: { include: [frontend, mini] },
    cssLoaderOption: { url: { filter: (url) => !url.startsWith('/') } },
    postcss: {
      pxtransform: { enable: true, config: {} },
      htmltransform: { enable: true, config: { removeCursorStyle: true } },
      [path.join(root, 'scripts/strip-weapp-css.cjs')]: {}
    },
    webpackChain(chain, webpack) {
      chain.resolve.modules.add(path.join(root, 'node_modules'));
      chain.module.rule('sql-source').test(/\.sql$/).type('asset/source');
      chain.plugin('spike-node-crypto').use(webpack.NormalModuleReplacementPlugin, [
        /^node:crypto$/,
        path.join(root, 'scripts/node-crypto-stub.cjs')
      ]);
      chain.plugin('spike-node-fs').use(webpack.NormalModuleReplacementPlugin, [
        /^node:fs$/,
        path.join(root, 'scripts/node-fs-stub.cjs')
      ]);
      chain.plugin('shushugo-shared-shims').use(webpack.NormalModuleReplacementPlugin, [
        /.*/,
        (resource) => {
          if (/^(@capacitor\/|@capacitor-community\/|@aparajita\/)/.test(resource.request)) {
            resource.request = path.join(root, 'scripts/native-stubs.cjs');
            return;
          }
          if (!resource.context || !resource.request.startsWith('.')) return;
          const fromShim = resource.context.startsWith(path.join(mini, 'scripts/shared/shims'));
          const target = path.resolve(fromShim ? path.join(mini, 'src/shared') : resource.context, resource.request)
            .replace(/\.(tsx?|jsx?|js|json)$/, '')
            .replace(/\?raw$/, '');
          if (target === path.join(mini, 'src/config')) {
            resource.request = path.join(root, 'scripts/offline-config.cjs');
            return;
          }
          if (target === path.join(mini, 'src/shared/content')) {
            resource.request = path.join(root, 'scripts/taro-content.cjs');
            return;
          }
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
