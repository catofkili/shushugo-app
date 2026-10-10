import type { PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
import { useLaunch } from '@tarojs/taro';
import { hooks } from '@tarojs/shared';
import { startStartupTiming } from '../../frontend/src/lib/perf-marks';
import './platform/app-polyfills.weapp';
import './platform/html-text-template.weapp.cjs';
import './platform/html-textarea-events.weapp.cjs';
import './platform/iframe-polyfill.weapp';
import { startFeedbackRuntime } from './platform/feedback-runtime.weapp';
import { pageShareFor, shareAppMessage } from '../../frontend/src/lib/page-share.weapp';
import './app.css';
// Keep native control resets below the user-agent styles but before shared page classes.
import './platform/mini-overrides.weapp.css';
import '../../frontend/src/styles.css';
import '../../frontend/src/app.css';
import '../../frontend/src/design.css';
import '../../frontend/src/skins.css';

// Taro includes onPageScroll in every Page config by default. No W14 route
// subscribes to it, so keep scroll events out of the native-to-JS lifecycle bridge.
hooks.tap('getMiniLifecycle', (lifecycle) => {
  const page = [...lifecycle.page] as typeof lifecycle.page;
  page[5] = page[5].filter((name) => name !== 'onPageScroll');
  return { ...lifecycle, page };
});

// 每个页面都能「转发给好友」：Taro 只给 page config 写了 enableShareAppMessage 的页面挂分享，
// 其余页面右上角菜单一直是「当前页面不可转发」（2026-10-09 真机）。这里只补没挂的页面
// （组队 / 对战自己开了，不覆盖）；标题和落地页由页面 usePageShare 登记，没登记的发通用卡片进主页。
// ⚠️ 故意不挂 onShareTimeline：朋友圈点开是「单页模式」，不能登录、不走正常启动，这些页面在那儿打不开；
// 朋友圈走分享图（ShareImageSheet → showShareImageMenu）。
hooks.tap('modifyPageObject', (page) => {
  if (page.onShareAppMessage) return;
  page.onShareAppMessage = function (this: Parameters<typeof pageShareFor>[0], event = {}) {
    return shareAppMessage(event, pageShareFor(this));
  };
});

startFeedbackRuntime();

export default function App({ children }: PropsWithChildren) {
  useLaunch(() => startStartupTiming());
  return <View className="taro-spike-shell"><View className="taro-spike-content">{children}</View></View>;
}
