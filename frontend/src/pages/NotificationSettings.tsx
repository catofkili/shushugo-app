import { ArrowLeft, Bell, BellRing, FileText, Volume2 } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { MascotSay } from "../components/MascotSay";
import {
  checkReminderPermission,
  defaultReminderSettings,
  loadReminderSettings,
  ReminderSettings,
  ReminderSyncResult,
  sendStudyReminderTest,
  syncReminderNotifications,
  syncWeeklyReportNotification
} from "../lib/notifications";

interface NotificationSettingsProps {
  onBack: () => void;
}

const staggerStyle = (index: number) => ({ "--i": index < 8 ? index : 0 }) as CSSProperties;

const buildStatusText = (result: ReminderSyncResult) => {
  if (!result.native) return "浏览器预览不会发送系统通知，iOS App 内会生效。";
  if (result.permission === "granted") return `iOS 通知已接通，当前有 ${result.pendingCount} 个提醒计划。`;
  if (result.permission === "denied") return "系统通知权限已关闭，请到 iOS 设置里允许通知。";
  return "开启学习或复习提醒时，会向 iOS 请求通知权限。";
};

export function NotificationSettings({ onBack }: NotificationSettingsProps) {
  const [settings, setSettings] = useState<ReminderSettings>(defaultReminderSettings);
  const [status, setStatus] = useState<ReminderSyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("正在读取通知设置…");

  useEffect(() => {
    let alive = true;
    loadReminderSettings()
      .then(async (saved) => {
        if (!alive) return;
        setSettings(saved);
        const permission = await checkReminderPermission();
        if (!alive) return;
        if (permission.native && permission.permission === "granted") {
          const synced = await syncReminderNotifications(saved, false);
          if (!alive) return;
          setStatus(synced);
          setMessage(buildStatusText(synced));
          return;
        }
        setStatus(permission);
        setMessage(buildStatusText(permission));
      })
      .catch(() => {
        if (!alive) return;
        setMessage("通知设置读取失败，请稍后重试。");
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateSettings = async (patch: Partial<ReminderSettings>, requestPermission = false) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSyncing(true);
    setMessage("正在同步到 iOS 通知…");
    try {
      const result = await syncReminderNotifications(next, requestPermission);
      const weekly = await syncWeeklyReportNotification(next, requestPermission);
      setStatus({ ...result, pendingCount: Math.max(result.pendingCount, weekly.pendingCount) });
      setMessage(buildStatusText(result));
    } catch {
      setMessage("通知同步失败，请确认系统权限后再试。");
    } finally {
      setSyncing(false);
    }
  };

  const testNotification = async () => {
    setTesting(true);
    setMessage("正在请求权限并发送测试通知…");
    try {
      const result = await sendStudyReminderTest();
      setStatus(result);
      if (!result.native) {
        setMessage("浏览器预览不会发送系统通知，请在 iOS App 真机里测试。");
      } else if (result.permission === "granted") {
        setMessage("测试通知已安排，约 2 秒后会出现在通知栏；同时已同步每日学习提醒。");
      } else if (result.permission === "denied") {
        setMessage("系统通知权限被拒绝了，请到 iOS 设置里允许收集日发送通知。");
      } else {
        setMessage("还没有拿到通知权限，请允许通知后再试。");
      }
    } catch {
      setMessage("测试通知发送失败，请确认系统权限后再试。");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="page-backbar mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">通知提醒</p>
      </div>

      {/* 推送通知 */}
      <div className="mb-4">
        <p className="ds-section">推送通知</p>
        <div className="ds-card w7-list ds-stagger overflow-hidden">
          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(0)}>
            <BellRing size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">通知栏测试</p>
              <p className="mt-0.5 text-xs text-white/50">请求权限，并立刻发一条学习提醒测试</p>
            </div>
            <button
              onClick={testNotification}
              disabled={testing || syncing}
              className="ds-btn-soft w7-small-button focus-ring shrink-0 disabled:opacity-50"
            >
              {testing ? "发送中" : "测试"}
            </button>
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(1)}>
            <Bell size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">学习提醒</p>
              <p className="mt-0.5 text-xs text-white/50">每天提醒你按时学习</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {settings.studyReminder && (
                <input
                  type="time"
                  value={settings.studyTime}
                  aria-label="学习提醒时间"
                  onChange={(e) => updateSettings({ studyTime: e.target.value })}
                  className="ds-chip w7-time-chip focus-ring"
                />
              )}
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.studyReminder}
                  onChange={(e) => updateSettings({ studyReminder: e.target.checked }, e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
              </label>
            </div>
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(2)}>
            <Bell size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">复习提醒</p>
              <p className="mt-0.5 text-xs text-white/50">到期复习时提醒你</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {settings.reviewReminder && (
                <input
                  type="time"
                  value={settings.reviewTime}
                  aria-label="复习提醒时间"
                  onChange={(e) => updateSettings({ reviewTime: e.target.value })}
                  className="ds-chip w7-time-chip focus-ring"
                />
              )}
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.reviewReminder}
                  onChange={(e) => updateSettings({ reviewReminder: e.target.checked }, e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
              </label>
            </div>
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(3)}>
            <FileText size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">学习回顾通知</p>
              <p className="mt-0.5 text-xs text-white/50">周日下午 14:30，提醒你查看这一周的回顾</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.weeklyReportReminder}
                onChange={(e) => updateSettings({ weeklyReportReminder: e.target.checked }, e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(4)}>
            <Bell size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">成就通知</p>
              <p className="mt-0.5 text-xs text-white/50">获得成就时通知</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.achievementNotif}
                onChange={(e) => updateSettings({ achievementNotif: e.target.checked }, e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>
        </div>
      </div>

      {/* 声音和振动 */}
      <div className="mb-4">
        <p className="ds-section">声音和振动</p>
        <div className="ds-card w7-list ds-stagger overflow-hidden">
          <div className="w7-row flex items-center gap-3 px-4 py-3" style={staggerStyle(0)}>
            <Volume2 size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">通知声音</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <div className="w7-row flex w-full items-center gap-3 px-4 py-3 text-left" style={staggerStyle(1)}>
            <Volume2 size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-white">铃声来源</p>
              <p className="mt-0.5 text-xs text-white/50">
                iOS 使用系统默认提示音；关闭通知声音后会静音发送。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 通知的状态由吉祥物说：接通了是欢呼，被系统关掉是犯愁，其它时候是在问 */}
      <MascotSay
        sticker={syncing ? "scene-laptop" : !status?.native ? "mood-ask" : status.permission === "granted" ? "mood-yay" : status.permission === "denied" ? "mood-puzzled" : "mood-ask"}
        tone={!status?.native ? "info" : status.permission === "denied" ? "warn" : status.permission === "granted" ? "good" : "info"}
        className="ds-say-onbg"
      >
        {syncing ? "正在同步提醒计划…" : message}
      </MascotSay>
    </div>
  );
}
