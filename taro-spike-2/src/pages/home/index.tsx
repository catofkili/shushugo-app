import '../../platform/app-polyfills.weapp';
import { useReady } from '@tarojs/taro';
import { recordStartupMilestone } from '../../../../frontend/src/lib/perf-marks';
import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/home.tsx'), 'HomeRoute');
export default function HomePage() {
  useReady(() => recordStartupMilestone('主页第一帧'));
  return <WeappPage page="home" Route={Route} />;
}
