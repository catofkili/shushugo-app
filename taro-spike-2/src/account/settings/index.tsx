import { SettingsRoute } from '../../../../frontend/src/routes/settings.tsx';
import { WeappPage } from '../../platform/WeappPage';

// SettingsRoute 直接渲染网页 SettingsPage：spellingEnabled / includeOptionalExpressions
// 共用 SettingsSwitch 的 checked/onChange、文案和偏好变更通知，不另存一份小程序状态。
export default () => <WeappPage page="settings" Route={SettingsRoute} />;
