import type { PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
import { useLaunch } from '@tarojs/taro';
import { hooks } from '@tarojs/shared';
import { startStartupTiming } from '../../frontend/src/lib/perf-marks';
import './platform/app-polyfills.weapp';
import './platform/html-text-template.weapp.cjs';
import './platform/iframe-polyfill.weapp';
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

export default function App({ children }: PropsWithChildren) {
  useLaunch(() => startStartupTiming());
  return <View className="taro-spike-shell"><View className="taro-spike-content">{children}</View></View>;
}
