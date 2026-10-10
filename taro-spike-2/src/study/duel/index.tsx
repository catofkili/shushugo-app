import { useState } from 'react';
import Taro, { useLoad, useShareAppMessage } from '@tarojs/taro';
import { DuelRoute } from '../../../../frontend/src/routes/duel.tsx';
import { setAppState } from '../../../../frontend/src/app/app-store';
import { duelIdFromUrl } from '../../../../frontend/src/lib/duel-links';
import type { PageShare } from '../../../../frontend/src/lib/page-share';
import { PageShareContext, shareAppMessage } from '../../../../frontend/src/lib/page-share.weapp';
import { WeappPage } from '../../platform/WeappPage';

export default function DuelEntry() {
  const [share, setShare] = useState<PageShare | null>(null);
  useLoad((params) => {
    const query = Taro.getCurrentInstance().router?.params ?? params;
    // 无 query 的应用内跳转已通过 navigate 写入 duelId，不能把交卷结果清掉。
    if ('id' in query) setAppState({ duelId: duelIdFromUrl('', query) });
  });
  useShareAppMessage((event) => shareAppMessage(event, share ?? { title: '收集日单词挑战', path: '/study/duel/index' }));
  return <PageShareContext.Provider value={setShare}><WeappPage page="duel" Route={DuelRoute} /></PageShareContext.Provider>;
}
