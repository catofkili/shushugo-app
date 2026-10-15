import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, Download, Languages, ListOrdered, Moon, RotateCcw, ScrollText, Smartphone, Sparkles, Sun, Type, Upload, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Capacitor } from "@capacitor/core";
import { DailyPlanPanel } from "../components/DailyPlanPanel";
import { SelectField } from "../components/SelectField";
import { KanjiUnitPlanSettings } from "../components/KanjiUnitPlanSettings";
import { useEntitlements } from "../hooks/useEntitlements";
import { devForcePro, setDevForcePro } from "../lib/entitlements";
import { exportDatabase } from "../lib/database";
import { clearLocalAppData } from "../lib/clear-local-data";
import { clearStorage, restoreDatabaseBackup, saveDatabase } from "../lib/storage";
import { getPasscodeState, verifyPasscode } from "../lib/localPasscode";
import { defaultVoiceId, loadVoices, SYSTEM_VOICE_ID, type AudioVoice } from "../lib/speech";
import { voiceUnlocked } from "../lib/yuzu";
import { confirmDialog } from "../lib/platform-dialogs";
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
  STUDY_BUDDY_SHELVED,
  StudyPreferences,
  ThemePreference
} from "../lib/studyPreferences";
import { importExternalWordList, previewExternalWordList } from "../lib/word-list-import";
import { MascotSay } from "../components/MascotSay";
import { yieldToPaint } from "../lib/yield-to-paint";
import { getAutoSendErrors, setAutoSendErrors } from "../lib/feedback";

interface SettingsPageProps {
  onBack: () => void;
  onRequireAuth: () => void;
}

type SegmentOption<Value extends string> = { value: Value; label: string; icon?: typeof Sun };

function SegmentedControl<Value extends string>({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: Value;
  options: readonly SegmentOption<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    <div className="w10-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className="ds-chip w10-segment focus-ring"
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SettingsSwitch({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="peer sr-only" />
      <span className="h-6 w-11 rounded-full bg-white/20 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5" />
    </label>
  );
}

const themeOptions: SegmentOption<ThemePreference>[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Smartphone }
];
const motionOptions = [
  { value: "full", label: "全开" },
  { value: "reduced", label: "省电" },
  { value: "off", label: "关闭" }
] as const;

const CLEAR_CONFIRM_TEXT = "清除所有数据";
const staggerStyle = (index: number) => ({ "--i": index < 8 ? index : 0 }) as CSSProperties;

export function SettingsPage({ onBack: _onBack, onRequireAuth }: SettingsPageProps) {
  const isWechatMini = Capacitor.getPlatform() === "wechat";
  const entitlements = useEntitlements();
  const [preferences, setPreferences] = useState<StudyPreferences>(defaultStudyPreferences);
  const [autoSendErrors, setAutoSendErrorsState] = useState(getAutoSendErrors);
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
      const confirmed = await confirmDialog(
        [
          `识别到 ${preview.validRows} 个词条。`,
          preview.duplicateRows ? `文件内重复 ${preview.duplicateRows} 行会自动跳过。` : "",
          preview.skippedRows ? `另有 ${preview.skippedRows} 行未识别。` : "",
          sampleText ? `示例：${sampleText}` : "",
          "导入只追加新词，不覆盖现有数据；带记忆记录的词会分批进复习。"
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

  const pushCloud = async () => {
    const confirmed = await confirmDialog("确定要用本机学习数据覆盖云端备份吗？如果这是切换账号后的本机数据，请先确认账号无误。");
    if (!confirmed) return;
    runCloudAction(pushCloudBackup, "云端备份已上传。");
  };

  const pullCloud = async () => {
    const confirmed = await confirmDialog("确定要把当前账号的云端进度合并到本机吗？建议先导出一份本机备份。");
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
    <div className="mx-auto max-w-3xl pb-4 ds-stagger">
      {import.meta.env.DEV && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4" style={staggerStyle(0)}>
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

      <div className="mb-4" style={staggerStyle(1)}>
        <p className="ds-section">外观</p>
        <div className="ds-card w10-theme-row flex items-center justify-between gap-3 p-3">
          <p className="shrink-0 text-[15px] font-bold text-white">主题</p>
          <SegmentedControl
            ariaLabel="主题"
            value={preferences.theme}
            options={themeOptions}
            onChange={(theme) => updatePreference({ theme })}
          />
        </div>
      </div>

      <div className="mb-4" style={staggerStyle(2)}>
        <p className="ds-section">反馈与诊断</p>
        <div className="ds-card w7-list">
          <div className="w7-row w7-row-plain flex items-center gap-3 px-4 py-3">
            <AlertTriangle size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">出错时自动发送诊断信息</p>
              <p className="mt-1 block text-xs text-white/50">关闭后，每次发送前都会询问你。</p>
            </div>
            <SettingsSwitch
              label="出错时自动发送诊断信息"
              checked={autoSendErrors}
              onChange={(enabled) => {
                setAutoSendErrorsState(enabled);
                setAutoSendErrors(enabled);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mb-4" style={staggerStyle(3)}>
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">每日学习量</p>
        {/* 圆环 / 数字表单 / 备考一键都在 DailyPlanPanel 里，和主页是同一个组件、同一份状态。
            别再往这一节插开关：它只装「今天给我多少题」这一类的量。 */}
        {/* 面板自己就是一张卡，外面不再包一层（以前是卡里一张卡） */}
        <DailyPlanPanel />
        {/* 汉字读音（词里遮汉字那个方向）是另一套队列（字音单位），题量和目标级别单独存，不在圆环里 */}
        <div className="mt-3 ds-card w7-list w10-kanji-card">
          <KanjiUnitPlanSettings />
        </div>
      </div>

      <div className="mb-4" style={staggerStyle(4)}>
        <p className="ds-section">学习偏好</p>
        <div className="ds-card w7-list">
          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <Volume2 size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">自动播放发音</p>
              <p className="mt-1 block text-xs text-white/50">显示单词答案时读出日语</p>
            </div>
            <SettingsSwitch label="自动播放发音" checked={preferences.autoPlay} onChange={(autoPlay) => updatePreference({ autoPlay })} />
          </div>

          {/* 声音只列磁盘上真实生成过的(scripts/build-word-audio.mjs 产出)。
              一个都没生成时整块不显示——那时候只有系统语音可用,给个选项也没意义。 */}
          {voices.length > 0 && (
            <div className="w7-row flex items-center gap-3 px-4 py-3">
              <Volume2 size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
              <div className="min-w-0 flex-1 text-left">
                <p className="block text-[15px] font-bold text-white">发音声音</p>
                <p className="mt-1 block text-xs text-white/50">{isWechatMini ? "使用云端音色播放" : "系统语音不占空间，语调较平"}</p>
              </div>
              <SelectField
                ariaLabel="发音声音"
                value={preferences.voiceId}
                onChange={(voiceId) => updatePreference({ voiceId })}
                className="focus-ring control-cyan h-10 max-w-40 shrink-0 rounded-xl border px-2 text-xs font-bold"
                options={[
                  { value: "", label: "默认" },
                  ...voices.map((voice) => {
                    const locked = !voiceUnlocked(voice.id, defaultVoiceId());
                    return { value: voice.id, label: `${voice.label}${locked ? "(柚子商店解锁)" : ""}`, disabled: locked };
                  }),
                  ...(!isWechatMini ? [{ value: SYSTEM_VOICE_ID, label: "系统语音" }] : [])
                ]}
              />
            </div>
          )}

          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <Volume2 size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">答题音效</p>
              <p className="mt-1 block text-xs text-white/50">评分、翻卡、完成时的提示音</p>
            </div>
            <SettingsSwitch label="答题音效" checked={preferences.zooSounds} onChange={(zooSounds) => updatePreference({ zooSounds })} />
          </div>

          {!STUDY_BUDDY_SHELVED && <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">背词页陪伴水豚</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                aria-label="背词页陪伴水豚"
                checked={preferences.studyBuddy}
                onChange={(event) => updatePreference({ studyBuddy: event.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>}

          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <CalendarDays size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">每周学习回顾</p>
              <p className="mt-1 block text-xs text-white/50">主页入口与周日提醒</p>
            </div>
            <SettingsSwitch label="每周学习回顾" checked={preferences.weeklyReportEnabled} onChange={(weeklyReportEnabled) => updatePreference({ weeklyReportEnabled })} />
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <ListOrdered size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">题目上显示 JLPT 等级</p>
              <p className="mt-1 block text-xs text-white/50">在题目面标出 N5–N1</p>
            </div>
            <SettingsSwitch label="题目上显示 JLPT 等级" checked={preferences.showJlptLevel} onChange={(showJlptLevel) => updatePreference({ showJlptLevel })} />
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <Languages size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">显示罗马音</p>
              <p className="mt-1 block text-xs text-white/50">答案假名下方显示 romaji</p>
            </div>
            <SettingsSwitch label="显示罗马音" checked={preferences.showRomaji} onChange={(showRomaji) => updatePreference({ showRomaji })} />
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3">
            <Type size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">拼写</p>
              <p className="mt-1 block text-xs text-white/50">每天最后一次见面时拼写；选忘记后，这个词一直用拼写。</p>
            </div>
            <SettingsSwitch label="拼写" checked={preferences.spellingEnabled} onChange={(spellingEnabled) => updatePreference({ spellingEnabled })} />
          </div>

          <div className="w7-row flex items-center gap-3 px-4 py-3 w10-motion-row">
            <Sparkles size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <div className="min-w-0 flex-1 text-left">
              <p className="block text-[15px] font-bold text-white">动效强度</p>
              <p className="mt-1 block text-xs text-white/50">省电 = 关掉常驻动效</p>
            </div>
            <SegmentedControl
              ariaLabel="动效强度"
              value={preferences.motionLevel}
              options={motionOptions}
              onChange={(motionLevel) => updatePreference({ motionLevel })}
            />
          </div>
        </div>
      </div>

      <div className="mb-4" style={staggerStyle(5)}>
        <p className="ds-section">数据管理</p>
        <div className="ds-card w7-list overflow-hidden">
          <div className="border-b border-white/10 p-4">
            <div className="mb-3">
              <p className="text-[15px] font-bold text-white">云同步</p>
              <p className="mt-1 text-xs text-white/50">
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
              {/* 换设备顺序是唯一需要强调的步骤；容量告警用文字呈现，整页只保留这一只吉祥物。 */}
              <MascotSay sticker="scene-laptop" size={48} className="mt-3">
                第一次用：先在<b>有进度的设备</b>登录、点「上传本机进度」，再去新手机登录 —— 别先从空白手机上传。
              </MascotSay>
              {snapshotCapacity && snapshotCapacity.bytes > 0 && (
                <p className="mt-2 text-xs leading-5" style={{ color: snapshotCapacity.ratio >= 0.85 ? "var(--ds-warn-ink)" : "var(--ds-ink-3)" }}>
                  {snapshotCapacity.ratio >= 0.85 ? (
                    <>云备份已经 <b>{formatBytes(snapshotCapacity.bytes)} / {formatBytes(snapshotCapacity.limit)}</b>（{Math.round(snapshotCapacity.ratio * 100)}%）。超过上限云备份会停，先导出一份本地备份吧。</>
                  ) : (
                    <>云备份体积 {formatBytes(snapshotCapacity.bytes)} / {formatBytes(snapshotCapacity.limit)}（{Math.round(snapshotCapacity.ratio * 100)}%）</>
                  )}
                </p>
              )}
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
                        className="ds-btn-soft focus-ring disabled:opacity-50"
                      >
                        发送验证码
                      </button>
                      <button
                        onClick={verifyEmail}
                        disabled={cloudBusy || verificationCode.length !== 6}
                        className="ds-btn focus-ring disabled:opacity-50"
                      >
                        验证邮箱
                      </button>
                    </div>
                  )}
                  <button
                    onClick={pushCloud}
                    disabled={cloudBusy}
                    className="ds-btn focus-ring disabled:opacity-50"
                  >
                    上传本机进度
                  </button>
                  <button
                    onClick={pullCloud}
                    disabled={cloudBusy}
                    className="ds-btn-soft focus-ring disabled:opacity-50"
                  >
                    拉取云端进度
                  </button>
                  <button
                    onClick={logoutCloud}
                    disabled={cloudBusy}
                    className="ds-btn-soft focus-ring disabled:opacity-50 sm:col-span-2"
                  >
                    退出云同步账号
                  </button>
                </>
              ) : (
                <button
                  onClick={onRequireAuth}
                  disabled={!cloudSession.configured}
                  className="ds-btn focus-ring disabled:opacity-50 sm:col-span-2"
                >
                  登录后启用云同步
                </button>
              )}
            </div>
          </div>

          <button onClick={exportData} className="w7-row focus-ring flex w-full items-center gap-3 px-4 py-3 text-left">
            <Download size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-bold text-white">导出学习数据</span>
              <span className="mt-1 block text-xs text-white/50">导出为可恢复的数据库备份</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-[var(--ds-ink-3)]" />
          </button>

          <button onClick={() => wordListInputRef.current?.click()} className="w7-row focus-ring flex w-full items-center gap-3 px-4 py-3 text-left">
            <Upload size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-bold text-white">导入词单或 MOJi 复习记录</span>
              <span className="mt-1 block text-xs text-white/50">普通词单可直接导入；MOJi 完整复习记录需先用 Mac 导出</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-[var(--ds-ink-3)]" />
          </button>

          {/* 需要 Mac + 跑一次 python 脚本,能用的人极少,别让它常驻这一页 */}
          <details className="w10-disclosure w7-faq">
            <summary className="w7-faq-summary">
              <ScrollText size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
              <span className="min-w-0 flex-1 text-sm font-bold text-white">MOJi 复习记录迁移（需要 Mac）</span>
              <ChevronDown size={18} className="w7-faq-chevron" />
            </summary>
            <div className="px-4 pb-4 text-xs leading-6 text-[var(--ds-ink-2)]">
              <p className="mt-2">iPhone 不允许应用直接读取另一个应用的内部数据，所以本应用只能在 iPhone 上导入导出文件，不能直接读取 MOJi 的 .realm 或缓存文件。</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>在 Mac 的 MOJi 中登录，打开“背词/复习”页面并等待内容加载完成，然后退出 MOJi。</li>
                <li>在 Mac 上打开收集日项目文件夹中的“终端”。首次使用运行 <code>npm install --prefix scripts/moji-realm-export</code>。</li>
                <li>运行 <code>python3 scripts/export-moji-review-data.py --fetch</code>。脚本只读取你的 MOJi 复习记录，不会修改 MOJi 数据，也不会把登录凭据写入导出文件。</li>
                <li>桌面会生成 <code>shushugo-moji-review-export.json</code>；将它 AirDrop 到 iPhone，或存入“文件”。</li>
                <li>回到本页点“导入词单或 MOJi 复习记录”，选择该 JSON 并确认。不要选择 .realm、.db 或缓存文件。</li>
              </ol>
              <p className="mt-2 text-white/45">导入会把 Moji 的做题次数、错误次数和分数转换为本应用的复习强度，不会覆盖已有本机学习记录。Windows 或纯 iPhone 目前只能导入已经导出的 JSON，不能生成这份完整记录。</p>
            </div>
          </details>

          <button onClick={() => backupInputRef.current?.click()} className="w7-row focus-ring flex w-full items-center gap-3 px-4 py-3 text-left">
            <Upload size={20} className="shrink-0 text-[var(--ds-ink-2)]" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-bold text-white">恢复备份</span>
              <span className="mt-1 block text-xs text-white/50">选择本应用导出的 .db 文件，会覆盖本机进度</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-[var(--ds-ink-3)]" />
          </button>

          <button onClick={openClearDataPanel} className="w7-row focus-ring flex w-full items-center gap-3 px-4 py-3 text-left text-[var(--ds-danger)]">
            <RotateCcw size={20} className="shrink-0" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-bold">清除所有数据</span>
              <span className="mt-1 block text-xs text-[var(--ds-danger)]">危险操作，会删除学习进度和本机偏好</span>
            </span>
            <ChevronRight size={18} className="shrink-0" />
          </button>

          {clearPanelOpen && (
            <div className="border-t border-white/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--ds-danger)]" />
                <div>
                  <p className="text-sm font-bold text-[var(--ds-danger)]">红色警告：此操作不可撤销</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ds-ink-2)]">
                    将清除本机学习数据库、学习偏好、学习模式、语法笔记和标记，并恢复到内置初始词库。
                    账号登录状态、通知提醒和已购权益保留。建议先导出学习数据。
                  </p>
                </div>
              </div>
              <label className="mt-3 block text-xs font-bold text-[var(--ds-danger)]">
                {clearRequiresPasscode ? "输入本地访问口令确认" : `输入「${CLEAR_CONFIRM_TEXT}」确认`}
              </label>
              <input
                type={clearRequiresPasscode ? "password" : "text"}
                value={clearCredential}
                onChange={(event) => setClearCredential(event.target.value)}
                className="control-cyan focus-ring mt-2 w-full px-3 py-2 text-sm placeholder:text-white/35"
                placeholder={clearRequiresPasscode ? "本地访问口令" : CLEAR_CONFIRM_TEXT}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={clearData}
                  disabled={clearingData || !clearCredential}
                  className="focus-ring min-h-10 rounded-xl px-3 text-sm font-bold disabled:opacity-50"
                  style={{ background: "var(--ds-danger)", color: "var(--ds-surface)" }}
                >
                  {clearingData ? "清除中" : "确认清除"}
                </button>
                <button
                  onClick={() => {
                    setClearPanelOpen(false);
                    setClearCredential("");
                  }}
                  disabled={clearingData}
                  className="ds-btn-soft focus-ring disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
        <input
          ref={wordListInputRef}
          type="file"
          className="hidden"
          onChange={(event) => importWordList(event.target.files?.[0] ?? null)}
        />
        <input
          ref={backupInputRef}
          type="file"
          accept=".db,application/octet-stream"
          className="hidden"
          onChange={(event) => importData(event.target.files?.[0] ?? null)}
        />
      </div>

      {message && (
        <div className="ds-card mb-4 p-3 text-sm font-bold" style={{ ...staggerStyle(6), background: "var(--ds-primary-tint)", color: "var(--ds-primary-ink)" }}>
          {message}
        </div>
      )}

      <div className="mb-4" style={staggerStyle(7)}>
        <div className="ds-card w7-list overflow-hidden">
          <div className="w7-row w7-row-plain flex items-center justify-between gap-3 px-4 py-2">
            <p className="text-[15px] font-bold text-white">存储空间</p>
            <button onClick={refreshStorageInfo} className="ds-chip focus-ring min-h-8 px-3 text-xs">刷新</button>
          </div>
          <div className="w7-row w7-row-plain flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="text-[var(--ds-ink-2)]">数据库</span>
            <span className="font-bold text-white">{formatBytes(storageInfo?.database)}</span>
          </div>
          <div className="w7-row w7-row-plain flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="text-[var(--ds-ink-2)]">偏好与筛选</span>
            <span className="font-bold text-white">{formatBytes(storageInfo?.local)}</span>
          </div>
          <div className="w7-row w7-row-plain flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="text-white/80">总计</span>
            <span className="font-bold text-[var(--ds-primary-ink)]">{formatBytes(totalStorage)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
