import type { PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
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

export default function App({ children }: PropsWithChildren) {
  return <View className="taro-spike-shell"><View className="taro-spike-content">{children}</View></View>;
}
