import '../../platform/app-polyfills.weapp';
import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/home.tsx'), 'HomeRoute');
export default () => <WeappPage page="home" Route={Route} />;
