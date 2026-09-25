import { AlertTriangle, Check, ChevronRight, Download, Moon, RotateCcw, Smartphone, Sun, Upload, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DailyPlanPanel } from "../components/DailyPlanPanel";
import { KanjiUnitPlanSettings } from "../components/KanjiUnitPlanSettings";
import { useEntitlements } from "../hooks/useEntitlements";
import { devForcePro, setDevForcePro } from "../lib/entitlements";
import { exportDatabase } from "../lib/database";
import { clearLocalAppData } from "../lib/clear-local-data";
import { clearStorage, restoreDatabaseBackup, saveDatabase } from "../lib/storage";
import { getPasscodeState, verifyPasscode } from "../lib/localPasscode";
import { defaultVoiceId, loadVoices, SYSTEM_VOICE_ID, type AudioVoice } from "../lib/speech";
import { voiceUnlocked } from "../lib/yuzu";
import {
  CLOUD_AUTH_EVENT,
  cloudLogout,
  getCloudSession,
  pullCloudBackup,
  pushCloudBackup,
  exportSyncSnapshot,
  getSnapshotCapacity,
  sendCloudVerificationEmail,
  verifyCloudEmail,
  type CloudSession
} from "../lib/sync-api";
import {
  applyTheme,
  defaultStudyPreferences,
  getStudyPreferences,
  saveStudyPreferences,
  StudyPreferences,
  ThemePreference
} from "../lib/studyPreferences";
import { importExternalWordList, previewExternalWordList } from "../lib/word-list-import";
import { MascotSay } from "../components/MascotSay";
import { yieldToPaint } from "../lib/yield-to-paint";

interface SettingsPageProps {
  onBack: () => void;
  onRequireAuth: () => void;
}

const themeOptions: { value: ThemePreference; label: string; icon: typeof Moon }[] = [
  { value: "light", label: "白天浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Smartphone }
];

const CLEAR_CONFIRM_TEXT = "清除所有数据";

export function SettingsPage({ onBack: _onBack, onRequireAuth }: SettingsPageProps) {
  const entitlements = useEntitlements();
  const [preferences, setPreferences] = useState<StudyPreferences>(defaultStudyPreferences);
  // 有哪些声音可选要问磁盘(音频库是构建产物,可能一个都没生成)
  const [voices, setVoices] = useState<AudioVoice[]>([]);
  // null = 还没量出来。别拿 0 B 冒充答案 —— 用户会以为数据丢了。
  const [storageInfo, setStorageInfo] = useState<{ database: number; local: number } | null>(null);
  // 云备份的容量水位。上限卡的是**压缩前**的字节数,gzip 后再小也不算数,
  // 所以必须把这个数摆出来 —— 撞上限之后同步会直接停。
  const [snapshotCapacity, setSnapshotCapacity] = useState<{ bytes: number; limit: number; ratio: number } | null>(null);
  const [message, setMessage] = useState("");
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [cloudBusy, setCloudBusy] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [clearPanelOpen, setClearPanelOpen] = useState(false);
  const [clearRequiresPasscode, setClearRequiresPasscode] = useState(false);
  const [clearCredential, setClearCredential] = useState("");
  const [clearingData, setClearingData] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const wordListInputRef = useRef<HTMLInputElement | null>(null);

  const formatBytes = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined) return "计算中…";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const refreshStorageInfo = async () => {
    // 导出 SQLite 可能需要一段时间,不能在设置页首帧之前同步执行。
    await yieldToPaint();
    // 现导一次:没同步过的会话里那个数还是 0,摆一个 0 出来比不摆更误导。
    // 只在真的配了云同步时做 —— 这一步实测半秒左右,不该给用不上的人白花。
    if ((await getCloudSession()).configured) {
      try {
        await exportSyncSnapshot();
        setSnapshotCapacity(getSnapshotCapacity());
      } catch {
        setSnapshotCapacity(null);
      }
    }
    const data = exportDatabase();
    const localBytes = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return key.length + (localStorage.getItem(key)?.length ?? 0);
    }).reduce((sum, size) => sum + size, 0);
    setStorageInfo({
      database: data?.byteLength ?? 0,
      local: localBytes
    });
  };

  useEffect(() => {
    const savedPreferences = getStudyPreferences();
    setPreferences(savedPreferences);
    void refreshStorageInfo();
    getCloudSession().then((session) => {
      setCloudSession(session);
    });
    const refreshAuth = (event: Event) => {
      const session = (event as CustomEvent<CloudSession>).detail;
      if (session) setCloudSession(session);
    };
    window.addEventListener(CLOUD_AUTH_EVENT, refreshAuth);
    loadVoices().then(setVoices);
    return () => window.removeEventListener(CLOUD_AUTH_EVENT, refreshAuth);
  }, []);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2200);
  };

  const updatePreference = (patch: Partial<StudyPreferences>, text = "设置已保存。") => {
    const next = saveStudyPreferences({ ...preferences, ...patch });
    setPreferences(next);

    // 如果更新了主题，立即应用
    if (patch.theme !== undefined) {
      applyTheme();
    }

    notify(text);
    void refreshStorageInfo();
    return next;
  };

  const exportData = () => {
    const data = exportDatabase();
    if (!data) {
      notify("当前没有可导出的数据库。");
      return;
    }
    const backupBytes = new Uint8Array(data);
    const blob = new Blob([backupBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shushugo-backup-${new Date().toISOString().slice(0, 10)}.db`;
    link.click();
    URL.revokeObjectURL(url);
    notify("学习数据已导出。");
  };

  const importData = async (file: File | null) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      // 换库 + 换设备号 + 落盘只有一份实现(见 storage.restoreDatabaseBackup)。
      await restoreDatabaseBackup(new Uint8Array(buffer));
      notify("学习数据已恢复，页面即将刷新。");
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      notify("导入失败，请确认文件是收集日备份。");
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  };

  const importWordList = async (file: File | null) => {
    if (!file) return;
    try {
      if (/\.realm$/i.test(file.name)) {
        notify("这个数据库文件不能直接导入，请选择导出的词单文本文件。");
        return;
      }
      const text = await file.text();
      if (/class_DB_ReciteTestRecord|class_DB_Fav|FavDB\.realm/.test(text.slice(0, 20000))) {
        notify("这个数据库文件不能直接导入，请选择导出的词单文本文件。");
        return;
      }
      const preview = previewExternalWordList(text);
      if (preview.validRows === 0) {
        notify("没有识别到可导入的词条，请确认文件包含日文单词。");
        return;
      }

      const sampleText = preview.samples
        .slice(0, 3)
        .map((item) => `${item.kanji}${item.kana !== item.kanji ? `（${item.kana}）` : ""}`)
        .join("、");
      const confirmed = window.confirm(
        [
          `识别到 ${preview.validRows} 个词条。`,
          preview.duplicateRows ? `文件内重复 ${preview.duplicateRows} 行会自动跳过。` : "",
          preview.skippedRows ? `另有 ${preview.skippedRows} 行未识别。` : "",
          sampleText ? `示例：${sampleText}` : "",
          "导入会追加新词，并把带记忆信息的生词分批放入复习，不会覆盖整份数据库。"
        ].filter(Boolean).join("\n")
      );
      if (!confirmed) return;

      const result = importExternalWordList(text);
      await saveDatabase();
      await refreshStorageInfo();
      notify(`词单已导入：新增 ${result.inserted}，更新 ${result.updated}，待复习 ${result.queuedForReview}。`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "词单导入失败，请换 CSV、TSV、JSON 或文本文件。");
    } finally {
      if (wordListInputRef.current) wordListInputRef.current.value = "";
    }
  };

  const openClearDataPanel = async () => {
    const state = await getPasscodeState();
    setClearRequiresPasscode(state.enabled);
    setClearCredential("");
    setClearPanelOpen(true);
  };

  const clearData = async () => {
    setClearingData(true);
    try {
      if (clearRequiresPasscode) {
        const ok = await verifyPasscode(clearCredential);
        if (!ok) {
          notify("本地访问口令不正确。");
          return;
        }
      } else if (clearCredential !== CLEAR_CONFIRM_TEXT) {
        notify(`请输入「${CLEAR_CONFIRM_TEXT}」后再清除。`);
        return;
      }

      await clearStorage();
      clearLocalAppData();
      notify("本机学习数据和偏好已清除，页面即将刷新。");
      window.setTimeout(() => window.location.reload(), 900);
    } finally {
      setClearingData(false);
    }
  };

  const runCloudAction = async (action: () => Promise<string | CloudSession>, fallbackMessage: string) => {
    setCloudBusy(true);
    try {
      const result = await action();
      const session = await getCloudSession();
      setCloudSession(session);
      notify(typeof result === "string" ? result : fallbackMessage);
      void refreshStorageInfo();
    } catch (error) {
      notify(error instanceof Error ? error.message : "云同步操作失败。");
    } finally {
      setCloudBusy(false);
    }
  };

  const sendVerification = () => runCloudAction(
    sendCloudVerificationEmail,
    "验证码已发送到邮箱。"
  );

  const verifyEmail = () => runCloudAction(
    async () => {
      const session = await verifyCloudEmail(verificationCode);
      setCloudSession(session);
      setVerificationCode("");
      return "邮箱已验证。";
    },
    "邮箱已验证。"
  );

  const pushCloud = () => {
    const confirmed = window.confirm("确定要用本机学习数据覆盖云端备份吗？如果这是切换账号后的本机数据，请先确认账号无误。");
    if (!confirmed) return;
    runCloudAction(pushCloudBackup, "云端备份已上传。");
  };

  const pullCloud = () => {
    const confirmed = window.confirm("确定要把当前账号的云端进度合并到本机吗？建议先导出一份本机备份。");
    if (!confirmed) return;
    runCloudAction(async () => {
      const text = await pullCloudBackup();
      return text;
    }, "云端备份已恢复。");
  };

  const logoutCloud = () => runCloudAction(
    async () => {
      await cloudLogout();
      return "已退出云同步账号。";
    },
    "已退出云同步账号。"
  );

  const totalStorage = storageInfo && storageInfo.database + storageInfo.local;

  return (
    <div className="mx-auto max-w-3xl pb-4">
      {import.meta.env.DEV && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div>
            <p className="text-sm font-bold text-white">开发环境常开 Pro</p>
            <p className="mt-0.5 text-xs text-white/60">仅本地生效；云端免费状态不会关闭此开关。</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              aria-label="开发环境常开 Pro"
              checked={entitlements.source === "development" && devForcePro()}
              onChange={(event) => setDevForcePro(event.currentTarget.checked)}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5" />
          </label>
        </div>
      )}

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">外观</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="p-4">
            <p className="mb-3 text-sm font-bold text-white">主题模式</p>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((item) => {
                const Icon = item.icon;
                const active = preferences.theme === item.value;
                return (
                  <button
                    key={item.value}
                    onClick={() => updatePreference({ theme: item.value })}
                    className={`focus-ring flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 transition-all ${
                      active ? "border-[#81D8CF] bg-[#81D8CF]/10" : "border-white/20 bg-[#3c3f3f] hover:bg-[#4a4f4f]"
                    }`}
                  >
                    <Icon size={18} className={active ? "text-[#81D8CF]" : "text-white/60"} />
                    <span className="text-xs font-bold text-white">{item.label}</span>
                    {active && <Check size={12} className="text-[#81D8CF]" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">每日学习量</p>
        {/* 圆环 / 数字表单 / 备考一键都在 DailyPlanPanel 里，和主页是同一个组件、同一份状态。
            别再往这一节插开关：它只装「今天给我多少题」这一类的量。 */}
        {/* 面板自己就是一张卡，外面不再包一层（以前是卡里一张卡） */}
        <DailyPlanPanel />
        {/* 汉字读音（词里遮汉字那个方向）是另一套队列（字音单位），题量和目标级别单独存，不在圆环里 */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <KanjiUnitPlanSettings />
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">学习偏好</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
              <Volume2 size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">自动播放发音</p>
              <p className="mt-0.5 text-xs text-white/50">显示单词答案时读出日语</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={preferences.autoPlay}
                onChange={(event) => updatePreference({ autoPlay: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          {/* 声音只列磁盘上真实生成过的(scripts/build-word-audio.mjs 产出)。
              一个都没生成时整块不显示——那时候只有系统语音可用,给个选项也没意义。 */}
          {voices.length > 0 && (
            <div className="flex items-center gap-3 border-b border-white/10 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">发音声音</p>
                <p className="mt-0.5 text-xs text-white/50">系统语音不占空间，语调较平</p>
              </div>
              <select
                value={preferences.voiceId}
                onChange={(event) => updatePreference({ voiceId: event.target.value })}
                className="focus-ring control-cyan h-10 max-w-40 shrink-0 rounded-xl border px-2 text-xs font-bold"
              >
                <option value="">默认</option>
                {voices.map((voice) => {
                  const locked = !voiceUnlocked(voice.id, defaultVoiceId());
                  return <option key={voice.id} value={voice.id} disabled={locked}>{voice.label}{locked ? "(柚子商店解锁)" : ""}</option>;
                })}
                <option value={SYSTEM_VOICE_ID}>系统语音</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">答题音效</p>
              <p className="mt-0.5 text-xs text-white/50">评分 / 翻卡 / 完成时的木质提示音</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={preferences.zooSounds}
                onChange={(event) => updatePreference({ zooSounds: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>


          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">每周学习回顾</p>
              <p className="mt-0.5 text-xs text-white/50">主页入口与周日提醒</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={preferences.weeklyReportEnabled}
                onChange={(event) => updatePreference({ weeklyReportEnabled: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">题目上显示 JLPT 等级</p>
              <p className="mt-0.5 text-xs text-white/50">在题目面标出 N5–N1</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={preferences.showJlptLevel}
                onChange={(event) => updatePreference({ showJlptLevel: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">显示罗马音</p>
              <p className="mt-0.5 text-xs text-white/50">答案假名下方显示 romaji</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={preferences.showRomaji}
                onChange={(event) => updatePreference({ showRomaji: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <div className="border-t border-white/10 p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-white">动效强度</p>
              <p className="mt-0.5 text-xs text-white/50">省电 = 关掉常驻动效</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { value: "full", label: "全开" },
                { value: "reduced", label: "省电" },
                { value: "off", label: "⏸ 关闭" }
              ] as const).map((option) => (
                <button
                  key={option.value}
                  onClick={() => updatePreference({ motionLevel: option.value })}
                  className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                    preferences.motionLevel === option.value
                      ? "bg-[#81D8CF] text-[#2f3333]"
                      : "border border-white/15 bg-white/8 text-white/70"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">数据管理</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="border-b border-white/10 p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-white">云同步</p>
              <p className="mt-0.5 text-xs text-white/50">
                {cloudSession.configured
                  ? cloudSession.token
                    ? `已登录：${cloudSession.email} · ${
                      cloudSession.emailVerificationRequired
                        ? cloudSession.emailVerified ? "邮箱已验证" : "邮箱待验证"
                        : "云同步可用"
                    }`
                    : "可登录后把本机学习数据库备份到云端"
                  : "还没有配置 VITE_SYNC_API_URL，部署 Cloudflare Worker 后即可启用"}
              </p>
              {/* 顺序提醒是换设备时唯一会出事的一步，让吉祥物说；体积接近上限时它换成吓一跳 */}
              <MascotSay sticker="scene-laptop" size={48} className="mt-3">
                第一次用：先在<b>有进度的设备</b>登录、点「上传本机进度」，再去新手机登录 —— 别先从空白手机上传。
              </MascotSay>
              {snapshotCapacity && snapshotCapacity.bytes > 0 && (snapshotCapacity.ratio >= 0.85 ? (
                <MascotSay sticker="mood-shocked" tone="warn" size={48} className="mt-3">
                  云备份已经 <b>{formatBytes(snapshotCapacity.bytes)} / {formatBytes(snapshotCapacity.limit)}</b>（{Math.round(snapshotCapacity.ratio * 100)}%）。
                  超过上限云备份会停，先导出一份本地备份吧。
                </MascotSay>
              ) : (
                <p className="mt-2 text-xs leading-5 text-white/42">
                  云备份体积 {formatBytes(snapshotCapacity.bytes)} / {formatBytes(snapshotCapacity.limit)}（{Math.round(snapshotCapacity.ratio * 100)}%）
                </p>
              ))}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {cloudSession.token ? (
                <>
                  {cloudSession.emailVerificationRequired && !cloudSession.emailVerified && (
                    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_auto_auto]">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={verificationCode}
                        onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="focus-ring rounded-xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                        placeholder="输入 6 位邮箱验证码"
                        disabled={cloudBusy}
                      />
                      <button
                        onClick={sendVerification}
                        disabled={cloudBusy}
                        className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                      >
                        发送验证码
                      </button>
                      <button
                        onClick={verifyEmail}
                        disabled={cloudBusy || verificationCode.length !== 6}
                        className="focus-ring rounded-xl bg-[#81D8CF] px-3 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                      >
                        验证邮箱
                      </button>
                    </div>
                  )}
                  <button
                    onClick={pushCloud}
                    disabled={cloudBusy}
                    className="focus-ring rounded-xl bg-[#81D8CF] px-3 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                  >
                    上传本机进度
                  </button>
                  <button
                    onClick={pullCloud}
                    disabled={cloudBusy}
                    className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                  >
                    拉取云端进度
                  </button>
                  <button
                    onClick={logoutCloud}
                    disabled={cloudBusy}
                    className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/60 hover:bg-white/8 disabled:opacity-50 sm:col-span-2"
                  >
                    退出云同步账号
                  </button>
                </>
              ) : (
                <button
                  onClick={onRequireAuth}
                  disabled={!cloudSession.configured}
                  className="focus-ring rounded-xl bg-[#91C968] px-3 py-2 text-sm font-bold text-[#172112] hover:bg-[#B7E38D] disabled:opacity-50 sm:col-span-2"
                >
                  登录后启用云同步
                </button>
              )}
            </div>
          </div>

          <button onClick={exportData} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/16 text-[#81D8CF]">
              <Download size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">导出学习数据</p>
              <p className="mt-0.5 text-xs text-white/50">导出为可恢复的数据库备份</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>

          <button onClick={() => wordListInputRef.current?.click()} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/16 text-[#81D8CF]">
              <Upload size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">导入词单或 MOJi 复习记录</p>
              <p className="mt-0.5 text-xs text-white/50">普通词单可直接导入；MOJi 完整复习记录需先用 Mac 导出</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>
          <input
            ref={wordListInputRef}
            type="file"
            className="hidden"
            onChange={(event) => importWordList(event.target.files?.[0] ?? null)}
          />

          {/* 需要 Mac + 跑一次 python 脚本,能用的人极少,别让它常驻这一页 */}
          <details className="border-b border-white/10 bg-[#3c3f3f] px-4 py-3 text-xs leading-5 text-white/58">
            <summary className="cursor-pointer font-bold text-white/72">MOJi 复习记录迁移（需要 Mac）</summary>
            <p className="mt-2">iPhone 不允许应用直接读取另一个应用的内部数据，所以本应用只能在 iPhone 上导入导出文件，不能直接读取 MOJi 的 .realm 或缓存文件。</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>在 Mac 的 MOJi 中登录，打开“背词/复习”页面并等待内容加载完成，然后退出 MOJi。</li>
              <li>在 Mac 上打开收集日项目文件夹中的“终端”。首次使用运行 <code>npm install --prefix scripts/moji-realm-export</code>。</li>
              <li>运行 <code>python3 scripts/export-moji-review-data.py --fetch</code>。脚本只读取你的 MOJi 复习记录，不会修改 MOJi 数据，也不会把登录凭据写入导出文件。</li>
              <li>桌面会生成 <code>shushugo-moji-review-export.json</code>；将它 AirDrop 到 iPhone，或存入“文件”。</li>
              <li>回到本页点“导入词单或 MOJi 复习记录”，选择该 JSON 并确认。不要选择 .realm、.db 或缓存文件。</li>
            </ol>
            <p className="mt-2 text-white/45">导入会把 Moji 的做题次数、错误次数和分数转换为本应用的复习强度，不会覆盖已有本机学习记录。Windows 或纯 iPhone 目前只能导入已经导出的 JSON，不能生成这份完整记录。</p>
          </details>

          <button onClick={() => backupInputRef.current?.click()} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/16 text-[#81D8CF]">
              <Upload size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">恢复备份</p>
              <p className="mt-0.5 text-xs text-white/50">选择本应用导出的 .db 文件，会覆盖本机进度</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".db,application/octet-stream"
            className="hidden"
            onChange={(event) => importData(event.target.files?.[0] ?? null)}
          />

          <button onClick={openClearDataPanel} className="focus-ring flex w-full items-center gap-3 p-4 text-left text-red-200 hover:bg-red-500/12">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-500/16 text-red-200">
              <RotateCcw size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">清除所有数据</p>
              <p className="mt-0.5 text-xs text-red-100/60">危险操作，会删除学习进度和本机偏好</p>
            </div>
            <ChevronRight size={17} className="text-red-100/40" />
          </button>

          {clearPanelOpen && (
            <div className="border-t border-red-300/20 bg-red-950/25 p-4">
              <div className="flex items-start gap-3 rounded-2xl border border-red-300/25 bg-red-500/12 p-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-200" />
                <div>
                  <p className="text-sm font-bold text-red-100">红色警告：此操作不可撤销</p>
                  <p className="mt-1 text-xs leading-5 text-red-100/65">
                    将清除本机学习数据库、学习偏好、学习模式、语法笔记和标记，并恢复到内置初始词库。
                    账号登录状态、通知提醒和已购权益保留。建议先导出学习数据。
                  </p>
                </div>
              </div>
              <label className="mt-3 block text-xs font-bold text-red-100/75">
                {clearRequiresPasscode ? "输入本地访问口令确认" : `输入「${CLEAR_CONFIRM_TEXT}」确认`}
              </label>
              <input
                type={clearRequiresPasscode ? "password" : "text"}
                value={clearCredential}
                onChange={(event) => setClearCredential(event.target.value)}
                className="focus-ring mt-2 w-full rounded-2xl border border-red-300/30 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/35"
                placeholder={clearRequiresPasscode ? "本地访问口令" : CLEAR_CONFIRM_TEXT}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={clearData}
                  disabled={clearingData || !clearCredential}
                  className="focus-ring rounded-2xl bg-red-400 px-3 py-2 text-sm font-bold text-red-950 hover:bg-red-300 disabled:opacity-50"
                >
                  {clearingData ? "清除中" : "确认清除"}
                </button>
                <button
                  onClick={() => {
                    setClearPanelOpen(false);
                    setClearCredential("");
                  }}
                  disabled={clearingData}
                  className="focus-ring rounded-2xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/18 p-3 text-sm font-bold text-white">
          {message}
        </div>
      )}

      <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-white">存储空间</p>
          <button onClick={refreshStorageInfo} className="focus-ring rounded-xl border border-white/15 px-2 py-1 text-xs font-bold text-white/60">
            刷新
          </button>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-white/60">数据库</span>
            <span className="font-bold text-white">{formatBytes(storageInfo?.database)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">偏好与筛选</span>
            <span className="font-bold text-white">{formatBytes(storageInfo?.local)}</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-white/10 pt-2">
            <span className="text-white/80">总计</span>
            <span className="font-bold text-[#81D8CF]">{formatBytes(totalStorage)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
