import type { PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
import './platform/iframe-polyfill.weapp';
import './app.css';
import '../../frontend/src/styles.css';
import '../../frontend/src/app.css';
import '../../frontend/src/design.css';
import '../../frontend/src/skins.css';

export default function App({ children }: PropsWithChildren) {
  return <View className="taro-spike-shell" data-theme="light"><View className="taro-spike-content">{children}</View></View>;
}
