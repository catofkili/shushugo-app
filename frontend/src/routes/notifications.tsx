import { useApp } from "../app/AppContext";
import { NotificationSettings } from "./lazy-pages";
export function NotificationsRoute() { const { goBack } = useApp(); return <NotificationSettings onBack={goBack} />; }
