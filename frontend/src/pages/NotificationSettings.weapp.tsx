import { useEffect, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { defaultReminderSettings, loadReminderSettings, saveReminderSettings, checkReminderPermission, syncReminderNotifications, type ReminderSettings } from "../lib/notifications";

export function NotificationSettings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(defaultReminderSettings);
  const [credits, setCredits] = useState(0);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState("正在读取提醒状态…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadReminderSettings().then(async (value) => {
      if (!alive) return;
      setSettings(value);
      const status = await checkReminderPermission();
      if (!alive) return;
      setCredits(status.pendingCount);
      setAvailable(status.native);
      setMessage(status.native ? `已有 ${status.pendingCount} 条一次性提醒额度。` : "学习提醒尚未配置微信订阅模板。无法提供离线定时通知。");
    });
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    const next: ReminderSettings = { ...settings, studyReminder: !settings.studyReminder };
    setSettings(next);
    setBusy(true);
    setMessage(next.studyReminder ? "正在请求一次学习提醒授权…" : "学习提醒已关闭。已授权的微信订阅额度仍由微信管理。");
    try {
      const status = await syncReminderNotifications(next, next.studyReminder);
      setCredits(status.pendingCount);
      setAvailable(status.native);
      setMessage(status.native ? `已记录 ${status.pendingCount} 条一次性提醒额度。` : "微信学习提醒模板尚未配置，当前没有请求授权。");
      if (!status.native) await saveReminderSettings(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提醒设置保存失败。");
    } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-3xl pb-4">
    <div className="page-backbar mb-4 flex items-center gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78"><ArrowLeft size={17} />返回</button>
      <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">学习提醒</p>
    </div>
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]"><Bell size={20} /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-white">学习提醒</p><p className="mt-1 text-xs text-white/50">通过微信一次性订阅消息积累额度；不是每日离线排期。</p></div>
        <button onClick={() => void toggle()} disabled={busy || !available} className={`rounded-2xl px-3 py-2 text-xs font-bold disabled:opacity-45 ${settings.studyReminder ? "bg-[#81D8CF] text-[#2f3333]" : "border border-white/20 text-white"}`}>{busy ? "处理中" : !available ? "暂不可用" : settings.studyReminder ? "已开启" : "开启"}</button>
      </div>
      <p className="p-4 text-sm leading-6 text-white/65">{message}{credits ? ` 当前可用额度：${credits}。` : ""}</p>
      <p className="border-t border-white/10 px-4 pb-4 text-xs leading-5 text-white/45">成就、周报和 JLPT 提醒在小程序中隐藏。</p>
    </div>
  </div>;
}
