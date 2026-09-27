import { lazy } from "react";
import { useApp } from "../app/AppContext";
const NotificationSettings = lazy(() => import("../pages/NotificationSettings").then((module) => ({ default: module.NotificationSettings })));
export function NotificationsRoute() { const { goBack } = useApp(); return <NotificationSettings onBack={goBack} />; }
