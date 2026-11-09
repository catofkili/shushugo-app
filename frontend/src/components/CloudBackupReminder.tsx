import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { useApp } from "../app/AppContext";
import { hasLocalLearningData } from "../lib/sync-api";
import { localDate } from "../lib/level-plan";
import { useProgressUpdates } from "../lib/use-progress-updates";

const SNOOZED_ON_KEY = "mn-cloud-backup-reminder-snoozed-on";

/** 只由主页挂载，留在内容流里，不占 PersistenceBanner 的底部浮层位置。 */
export function CloudBackupReminder() {
  const { cloudSession, requireAccount, showNotice } = useApp();
  const [hasData, setHasData] = useState(hasLocalLearningData);
  const [snoozedOn, setSnoozedOn] = useState<string | null>(null);
  const [date, setDate] = useState(localDate);
  useProgressUpdates(() => setHasData(hasLocalLearningData()));

  useEffect(() => {
    let active = true;
    void Preferences.get({ key: SNOOZED_ON_KEY }).then(({ value }) => {
      if (active) setSnoozedOn(value ?? "");
    }).catch(() => { if (active) setSnoozedOn(""); });
    // 小程序 tab 隐藏后不会卸载；跨午夜或重新回到前台时也按本地日历换天。
    const refreshDate = () => setDate(localDate());
    const timer = setInterval(refreshDate, 60_000);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, []);

  // 微信通过已有云函数传输，故意没有 VITE_SYNC_API_URL；与 requireConfigured 的判据一致。
  const configured = cloudSession.configured || Capacitor.getPlatform() === "wechat";
  if (!configured || cloudSession.token || !hasData || snoozedOn === null || snoozedOn === date) return null;

  const later = () => {
    const today = localDate();
    setSnoozedOn(today);
    void Preferences.set({ key: SNOOZED_ON_KEY, value: today }).catch(() => showNotice("稍后提醒未能保存。"));
  };
  return (
    <div className="ds-inset flex flex-wrap items-center gap-3 p-4" role="status">
      <p className="min-w-0 flex-1 text-sm leading-6" style={{ color: "var(--ds-ink)", flexBasis: 256 }}>还没登录，学习记录只存在这台设备上</p>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="ds-btn-soft focus-ring" onClick={() => requireAccount()}>登录备份</button>
        <button type="button" className="ds-btn-soft focus-ring" onClick={later}>稍后</button>
      </div>
    </div>
  );
}
