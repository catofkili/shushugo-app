import { useEffect, useState } from 'react';
import { View } from '@tarojs/components';

const content = require('../../../scripts/taro-content.cjs') as { ready: () => Promise<void> };
const modules: Array<() => Promise<unknown>> = [
  () => import('../../../../frontend/src/pages/GrammarFoundationPage').then((page) => page.GrammarFoundationPage),
  () => import('../../../../frontend/src/pages/Library').then((page) => page.default),
  () => import('../../../../frontend/src/pages/ImmersiveGrammar').then((page) => page.ImmersiveGrammar),
  () => import('../../../../frontend/src/pages/FavoritesPage').then((page) => page.FavoritesPage),
  () => import('../../../../frontend/src/pages/GrammarDetail').then((page) => page.GrammarDetail),
  () => import('../../../../frontend/src/pages/ConfusionPage').then((page) => page.default)
];

export default function GrammarCompileProbe() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void content.ready()
      .then(() => Promise.all(modules.map((load) => load())))
      .then(() => { if (active) setReady(true); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  return <View>{error || (ready ? '6 个语法与辨析页面模块已加载' : '正在加载出厂内容')}</View>;
}
