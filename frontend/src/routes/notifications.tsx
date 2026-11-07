import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
const NotificationSettings = lazyPage(() => import("../pages/NotificationSettings").then((module) => ({ default: module.NotificationSettings })));
export function NotificationsRoute() { const { goBack } = useApp(); return <NotificationSettings onBack={goBack} />; }

export const preload = NotificationSettings.preload;
