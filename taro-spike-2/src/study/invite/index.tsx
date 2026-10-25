import { useCallback, useState } from 'react';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { InviteRoute } from '../../../../frontend/src/routes/invite';
import type { PageShare } from '../../../../frontend/src/lib/page-share';
import { PageShareContext, shareAppMessage } from '../../../../frontend/src/lib/page-share.weapp';
import { WeappPage } from '../../platform/WeappPage';

export default function InviteEntry() {
  const [share, setShare] = useState<PageShare | null>(null);
  const [ref] = useState(() => Taro.getCurrentInstance().router?.params?.ref);
  const Route = useCallback(() => <InviteRoute initialCode={typeof ref === 'string' ? ref : undefined} />, [ref]);
  useShareAppMessage((event) => shareAppMessage(event, share ?? { title: '一起在收集日学日语', path: '/study/invite/index' }));
  return <PageShareContext.Provider value={setShare}><WeappPage page="invite" Route={Route} /></PageShareContext.Provider>;
}
