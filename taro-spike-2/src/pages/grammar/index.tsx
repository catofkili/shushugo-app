import { lazyRoute } from '../../platform/lazy-route';
import { WeappPage } from '../../platform/WeappPage';

const Route = lazyRoute(() => import(/* webpackMode: "lazy", webpackChunkName: "lazy/tabs" */ '../../../../frontend/src/routes/grammar.tsx'), 'GrammarRoute');
export default () => <WeappPage page="grammar" Route={Route} />;
