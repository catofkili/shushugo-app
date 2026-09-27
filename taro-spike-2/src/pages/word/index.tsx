import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';
import { PerfOverlay } from '../../platform/preview-timing.weapp';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/word.tsx'), 'WordRoute');
// PerfOverlay 只在计时版预览里有内容（分段计时，见 preview-timing.weapp.tsx），普通构建是空组件。
export default () => <><WeappPage page="word" Route={Route} /><PerfOverlay /></>;
