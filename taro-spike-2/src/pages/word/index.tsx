import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/word.tsx'), 'WordRoute');
export default () => <WeappPage page="word" Route={Route} />;
