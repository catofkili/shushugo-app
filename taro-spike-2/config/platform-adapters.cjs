// 网页模块 → 小程序实现的替换表。config/index.js 构建时用它，scripts/verify-shim-exports.mjs 校验时也用它，
// 两边必须是同一份，否则校验查的和实际打包的不是一套东西。
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const frontend = path.join(repoRoot, 'frontend');

const platformAdapters = new Map([
  ['frontend/src/lib/haptics', path.join(frontend, 'src/lib/haptics.weapp.ts')],
  ['frontend/src/lib/pick-image', path.join(frontend, 'src/lib/pick-image.weapp.ts')],
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
  ['frontend/src/lib/use-progress-updates', path.join(root, 'src/platform/use-progress-updates.weapp.ts')],
  ['frontend/src/lib/feedback-runtime', path.join(root, 'src/platform/feedback-runtime.weapp.ts')],
  ['frontend/src/components/AuthDialog', path.join(frontend, 'src/components/AuthDialog.weapp.tsx')],
  ['frontend/src/components/ShareImageSheet', path.join(frontend, 'src/components/ShareImageSheet.weapp.tsx')],
  ['frontend/src/components/DailyPlanSlider', path.join(frontend, 'src/components/DailyPlanSlider.weapp.tsx')],
  ['frontend/src/components/DailyPlanRing', path.join(frontend, 'src/components/DailyPlanRing.weapp.tsx')],
  ['frontend/src/components/GrammarTermHint', path.join(frontend, 'src/components/GrammarTermHint.weapp.tsx')],
  ['frontend/src/pages/NotificationSettings', path.join(frontend, 'src/pages/NotificationSettings.weapp.tsx')],
  ['wechat-miniprogram/src/runtime/auth', path.join(root, 'src/platform/payment-auth.weapp.cjs')]
].map(([target, replacement]) => [path.join(repoRoot, target), replacement]));

module.exports = { platformAdapters };
