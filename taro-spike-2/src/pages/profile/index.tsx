import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/profile.tsx'), 'ProfileRoute');
export default () => <WeappPage page="profile" Route={Route} />;
