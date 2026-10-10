import { useCallback, useState } from 'react';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { TeamRoute } from '../../../../frontend/src/routes/team.tsx';
import type { PageShare } from '../../../../frontend/src/lib/page-share';
import { PageShareContext, shareAppMessage } from '../../../../frontend/src/lib/page-share.weapp';
import { WeappPage } from '../../platform/WeappPage';

export default function TeamEntry() {
  const [share, setShare] = useState<PageShare | null>(null);
  const [invite] = useState(() => {
    const value = Taro.getCurrentInstance().router?.params?.invite;
    return typeof value === 'string' ? value : '';
  });
  const Route = useCallback(() => <TeamRoute initialInviteCode={invite} />, [invite]);
  useShareAppMessage((event) => shareAppMessage(event, share ?? { title: '一起在收集日组队学习', path: '/study/team/index' }));
  return <PageShareContext.Provider value={setShare}><WeappPage page="team" Route={Route} /></PageShareContext.Provider>;
}
