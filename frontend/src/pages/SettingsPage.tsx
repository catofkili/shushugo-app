import { AlertTriangle, Check, ChevronRight, Download, Moon, RotateCcw, Smartphone, Sun, Upload, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refreshTodayWordPlan } from "../lib/api";
import { exportDatabase, importDatabase } from "../lib/database";
import { clearStorage, saveDatabase } from "../lib/storage";
import { getPasscodeState, verifyPasscode } from "../lib/localPasscode";
import {
  cloudLogin,
  cloudLogout,
  cloudRegister,
  deleteCloudAccount,
  getCloudSession,
  pullCloudBackup,
  pushCloudBackup,
  requestCloudPasswordReset,
  resetCloudPassword,
  sendCloudVerificationEmail,
  verifyCloudEmail,
  type CloudSession
} from "../lib/sync-api";
import {
  applyTheme,
  defaultStudyPreferences,
  getStudyPreferences,
  INTENSITY_ANCHORS,
  INTENSITY_MAX,
  INTENSITY_MIN,
  saveStudyPreferences,
  StudyPreferences,
  ThemePreference
} from "../lib/studyPreferences";
import { getDatabase } from "../lib/database";
import { importExternalWordList, previewExternalWordList } from "../lib/word-list-import";

interface GoalEstimationProps {
  dailyGoal: number;
}

function GoalEstimation({ dailyGoal }: GoalEstimationProps) {
  const [estimations, setEstimations] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const db = getDatabase();
      const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
      const newEstimations: Record<string, number> = {};

      levels.forEach(level => {
        const result = db.exec(`
          SELECT COUNT(*) as remaining
          FROM words w
          JOIN progress p ON p.word_id = w.id
          WHERE w.jlpt_level = ?
            AND p.known_forever = 0
            AND p.seen_count = 0
        `, [level]);

        if (result.length && result[0].values.length) {
          const remaining = Number(result[0].values[0][0]);
          const days = Math.ceil(remaining / dailyGoal);
          newEstimations[level] = days;
        }
      });

      setEstimations(newEstimations);
    } catch (error) {
      console.error('Failed to calculate estimations:', error);
    }
  }, [dailyGoal]);

  if (Object.keys(estimations).length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-[#3c3f3f] p-3">
      <p className="mb-2 text-xs font-bold text-white/60">预计完成时间（仅新词）</p>
      <div className="space-y-1 text-xs">
        {Object.entries(estimations).map(([level, days]) => (
          <div key={level} className="flex justify-between text-white/80">
            <span>{level}:</span>
            <span className="font-bold">
              {days > 365 ? `${Math.round(days / 365)}年` : days > 30 ? `${Math.round(days / 30)}个月` : `${days}天`}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-white/45">不含复习时间，实际会更长</p>
    </div>
  );
}

interface SettingsPageProps {
  onBack: () => void;
}

const themeOptions: { value: ThemePreference; label: string; icon: typeof Moon }[] = [
  { value: "light", label: "白天浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Smartphone }
];

const CLEAR_CONFIRM_TEXT = "清除所有数据";

export function SettingsPage({ onBack: _onBack }: SettingsPageProps) {
  const [preferences, setPreferences] = useState<StudyPreferences>(defaultStudyPreferences);
  const [storageInfo, setStorageInfo] = useState({ database: 0, local: 0, cache: 0 });
  const [message, setMessage] = useState("");
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [resetPanelOpen, setResetPanelOpen] = useState(false);
  const [deletePanelOpen, setDeletePanelOpen] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [clearPanelOpen, setClearPanelOpen] = useState(false);
  const [clearRequiresPasscode, setClearRequiresPasscode] = useState(false);
  const [clearCredential, setClearCredential] = useState("");
  const [clearingData, setClearingData] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const wordListInputRef = useRef<HTMLInputElement | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const refreshStorageInfo = () => {
    const data = exportDatabase();
    const localBytes = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return key.length + (localStorage.getItem(key)?.length ?? 0);
    }).reduce((sum, size) => sum + size, 0);
    setStorageInfo({
      database: data?.byteLength ?? 0,
      local: localBytes,
      cache: 0
    });
  };

  useEffect(() => {
    const savedPreferences = getStudyPreferences();
    setPreferences(savedPreferences);
    refreshStorageInfo();
    getCloudSession().then((session) => {
      setCloudSession(session);
      setCloudEmail(session.email ?? "");
    });
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
    refreshStorageInfo();
    return next;
  };

  const updateDailyGoal = (value: number) => {
    const next = updatePreference({ dailyGoal: value }, "学习强度已保存。");
    try {
      refreshTodayWordPlan();
      notify(`学习强度已改为每日新词 ${next.dailyGoal} 个，今日计划已刷新。`);
    } catch {
      notify("学习强度已保存，重启应用后生效。");
    }
  };

  const updateReviewCap = (value: number) => {
    const next = updatePreference({ reviewCap: value }, "复习上限已保存。");
    try {
      refreshTodayWordPlan();
      notify(next.reviewCap > 0
        ? `复习上限已改为每日 ${next.reviewCap} 个，超出部分顺延。`
        : "复习上限已改回自动（按近期节奏 × 1.5）。");
    } catch {
      notify("复习上限已保存，重启应用后生效。");
    }
  };

  const updateComebackMode = (value: StudyPreferences["comebackMode"]) => {
    updatePreference(
      { comebackMode: value },
      value === "pressure"
        ? "回归节奏已设为高强度,下次触发 2~3 天快清。"
        : "回归节奏已设为温和,下次触发按 7 天由轻到重摊还。"
    );
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
    link.download = `master-nihongo-backup-${new Date().toISOString().slice(0, 10)}.db`;
    link.click();
    URL.revokeObjectURL(url);
    notify("学习数据已导出。");
  };

  const importData = async (file: File | null) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await importDatabase(new Uint8Array(buffer), { validateBackup: true });
      await saveDatabase();
      notify("学习数据已恢复，页面即将刷新。");
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      notify("导入失败，请确认文件是 Master Nihongo 备份。");
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
      refreshStorageInfo();
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
      localStorage.removeItem("mn-study-preferences");
      localStorage.removeItem("mn-word-level");
      localStorage.removeItem("mn-word-type");
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
      setCloudEmail(session.email ?? cloudEmail);
      notify(typeof result === "string" ? result : fallbackMessage);
      refreshStorageInfo();
    } catch (error) {
      notify(error instanceof Error ? error.message : "云同步操作失败。");
    } finally {
      setCloudBusy(false);
    }
  };

  const loginCloud = () => runCloudAction(
    () => cloudLogin(cloudEmail, cloudPassword),
    "云同步账号已登录。"
  );

  const registerCloud = () => runCloudAction(
    () => cloudRegister(cloudEmail, cloudPassword),
    "云同步账号已创建，验证码已发送到邮箱。"
  );

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

  const requestPasswordReset = () => runCloudAction(
    () => requestCloudPasswordReset(cloudEmail),
    "如果该邮箱已注册，验证码会发送到邮箱。"
  );

  const submitPasswordReset = () => runCloudAction(
    async () => {
      const result = await resetCloudPassword(cloudEmail, resetCode, resetNewPassword);
      setResetCode("");
      setResetNewPassword("");
      setResetPanelOpen(false);
      setCloudPassword("");
      return result;
    },
    "密码已重置，请使用新密码登录。"
  );

  const pushCloud = () => runCloudAction(pushCloudBackup, "云端备份已上传。");

  const pullCloud = () => {
    const confirmed = window.confirm("确定要用云端备份覆盖本机学习数据吗？建议先导出一份本机备份。");
    if (!confirmed) return;
    runCloudAction(async () => {
      const text = await pullCloudBackup();
      window.setTimeout(() => window.location.reload(), 900);
      return text;
    }, "云端备份已恢复。");
  };

  const logoutCloud = () => runCloudAction(
    async () => {
      await cloudLogout();
      setCloudPassword("");
      return "已退出云同步账号。";
    },
    "已退出云同步账号。"
  );

  const deleteCloud = () => {
    const confirmed = window.confirm(
      "确定要永久删除云同步账号吗？\n云端备份、账号信息会立即删除且无法恢复。本机学习数据保留，App Store 购买可通过“恢复购买”重新激活。"
    );
    if (!confirmed) return;
    runCloudAction(async () => {
      await deleteCloudAccount(deleteAccountPassword);
      setDeleteAccountPassword("");
      setDeletePanelOpen(false);
      setCloudPassword("");
      return "云同步账号已删除，本机学习数据不受影响。";
    }, "云同步账号已删除。");
  };

  const totalStorage = storageInfo.database + storageInfo.local + storageInfo.cache;

  return (
    <div className="mx-auto max-w-3xl pb-4">

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
            <p className="mt-3 text-xs text-white/50">选择「跟随系统」后，会随 iOS 白天/深色外观自动切换。</p>
          </div>
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

          <div className="flex items-center gap-3 border-b border-white/10 p-4">
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

          <div className="border-b border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">学习强度</p>
                <p className="mt-0.5 text-xs text-white/50">每日新词数,唯一需要调的量。复习量由算法安排。</p>
              </div>
              <span className="shrink-0 text-sm font-bold text-[#81D8CF]">{preferences.dailyGoal} 个/天</span>
            </div>
            <input
              type="range"
              min={INTENSITY_MIN}
              max={INTENSITY_MAX}
              step={1}
              value={preferences.dailyGoal}
              onChange={(event) => updateDailyGoal(Number(event.target.value))}
              aria-label="学习强度"
              className="w-full accent-[#81D8CF]"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {INTENSITY_ANCHORS.map((anchor) => (
                <button
                  key={anchor.value}
                  onClick={() => updateDailyGoal(anchor.value)}
                  className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                    preferences.dailyGoal === anchor.value
                      ? "bg-[#81D8CF] text-[#2f3333]"
                      : "border border-white/15 bg-white/8 text-white/70"
                  }`}
                >
                  {anchor.label} {anchor.value}
                </button>
              ))}
            </div>

            {/* 目标完成时间预测 */}
            <GoalEstimation dailyGoal={preferences.dailyGoal} />
          </div>

          <div className="p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-white">每日复习上限</p>
              <p className="mt-0.5 text-xs text-white/50">
                学不完的顺延到后面几天,按遗忘风险排队,不会丢。自动 = 近期节奏 × 1.5(60-150)。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[0, 100, 150, 200, 300].map((cap) => (
                <button
                  key={cap}
                  onClick={() => updateReviewCap(cap)}
                  className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                    preferences.reviewCap === cap
                      ? "bg-[#81D8CF] text-[#2f3333]"
                      : "border border-white/15 bg-white/8 text-white/70"
                  }`}
                >
                  {cap === 0 ? "自动(推荐)" : `${cap} 个`}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-white">回归节奏</p>
              <p className="mt-0.5 text-xs text-white/50">
                长期没打卡、积压堆多了会触发回归模式。选清积压的节奏:温和由轻到重摊 7 天,高强度 2~3 天快清。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { value: "gentle", label: "🌱 温和(7天)" },
                { value: "pressure", label: "⚡ 高强度(2-3天)" }
              ] as const).map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateComebackMode(option.value)}
                  className={`focus-ring h-8 rounded-full px-3 text-xs font-bold ${
                    preferences.comebackMode === option.value
                      ? "bg-[#81D8CF] text-[#2f3333]"
                      : "border border-white/15 bg-white/8 text-white/70"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">
              改动在下次触发回归时生效,进行中的回归不受影响。
            </p>
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
                    ? `已登录：${cloudSession.email} · ${cloudSession.emailVerified ? "邮箱已验证" : "邮箱待验证"}`
                    : "可登录后把本机学习数据库备份到云端"
                  : "还没有配置 VITE_SYNC_API_URL，部署 Cloudflare Worker 后即可启用"}
              </p>
            </div>

            {!cloudSession.token && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="email"
                  value={cloudEmail}
                  onChange={(event) => setCloudEmail(event.target.value)}
                  className="focus-ring rounded-xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                  placeholder="邮箱"
                  disabled={cloudBusy || !cloudSession.configured}
                />
                <input
                  type="password"
                  value={cloudPassword}
                  onChange={(event) => setCloudPassword(event.target.value)}
                  className="focus-ring rounded-xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                  placeholder="密码（至少8位）"
                  disabled={cloudBusy || !cloudSession.configured}
                />
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {cloudSession.token ? (
                <>
                  {!cloudSession.emailVerified && (
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
                  <button
                    onClick={() => {
                      setDeletePanelOpen((value) => !value);
                      setDeleteAccountPassword("");
                    }}
                    disabled={cloudBusy}
                    className="focus-ring rounded-xl border border-red-400/30 px-3 py-2 text-sm font-bold text-red-300/80 hover:bg-red-400/10 disabled:opacity-50 sm:col-span-2"
                  >
                    删除云同步账号
                  </button>
                  {deletePanelOpen && (
                    <div className="rounded-2xl border border-red-400/25 bg-[#3c3f3f] p-3 sm:col-span-2">
                      <p className="text-xs font-bold text-red-300/85">
                        删除后云端备份和账号信息立即清除且无法恢复；本机学习数据保留，App Store 购买可通过“恢复购买”重新激活。
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          type="password"
                          value={deleteAccountPassword}
                          onChange={(event) => setDeleteAccountPassword(event.target.value)}
                          className="focus-ring rounded-xl border border-white/20 bg-[#464949] px-3 py-2 text-sm text-white placeholder:text-white/40"
                          placeholder="输入账号密码确认删除"
                          disabled={cloudBusy}
                        />
                        <button
                          onClick={deleteCloud}
                          disabled={cloudBusy || deleteAccountPassword.length < 8}
                          className="focus-ring rounded-xl bg-red-400/85 px-4 py-2 text-sm font-bold text-[#2b2020] hover:bg-red-300 disabled:opacity-50"
                        >
                          永久删除
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={loginCloud}
                    disabled={cloudBusy || !cloudSession.configured || !cloudEmail || !cloudPassword}
                    className="focus-ring rounded-xl bg-[#81D8CF] px-3 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                  >
                    登录云同步
                  </button>
                  <button
                    onClick={registerCloud}
                    disabled={cloudBusy || !cloudSession.configured || !cloudEmail || cloudPassword.length < 8}
                    className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                  >
                    创建账号
                  </button>
                  <button
                    onClick={() => setResetPanelOpen((value) => !value)}
                    disabled={cloudBusy || !cloudSession.configured || !cloudEmail}
                    className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/60 hover:bg-white/8 disabled:opacity-50 sm:col-span-2"
                  >
                    忘记密码 / 重置密码
                  </button>
                </>
              )}
            </div>

            {!cloudSession.token && resetPanelOpen && (
              <div className="mt-3 rounded-2xl border border-white/15 bg-[#3c3f3f] p-3">
                <p className="text-xs font-bold text-white/65">先输入上方邮箱，点击发送验证码，再输入验证码和新密码。</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={requestPasswordReset}
                    disabled={cloudBusy || !cloudEmail}
                    className="focus-ring rounded-xl border border-white/20 px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
                  >
                    发送重置验证码
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="focus-ring rounded-xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                    placeholder="6 位验证码"
                    disabled={cloudBusy}
                  />
                  <input
                    type="password"
                    value={resetNewPassword}
                    onChange={(event) => setResetNewPassword(event.target.value)}
                    className="focus-ring rounded-xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
                    placeholder="新密码（至少8位）"
                    disabled={cloudBusy}
                  />
                  <button
                    onClick={submitPasswordReset}
                    disabled={cloudBusy || resetCode.length !== 6 || resetNewPassword.length < 8}
                    className="focus-ring rounded-xl bg-[#81D8CF] px-3 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
                  >
                    确认重置密码
                  </button>
                </div>
              </div>
            )}
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

          <div className="border-b border-white/10 bg-[#3c3f3f] px-4 py-3 text-xs leading-5 text-white/58">
            <p className="font-bold text-white/72">MOJi 复习记录迁移（需要 Mac）：</p>
            <p className="mt-1">iPhone 不允许应用直接读取另一个应用的内部数据，所以本应用只能在 iPhone 上导入导出文件，不能直接读取 MOJi 的 .realm 或缓存文件。</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>在 Mac 的 MOJi 中登录，打开“背词/复习”页面并等待内容加载完成，然后退出 MOJi。</li>
              <li>在 Mac 上打开 Master Nihongo 项目文件夹中的“终端”。首次使用运行 <code>npm install --prefix scripts/moji-realm-export</code>。</li>
              <li>运行 <code>python3 scripts/export-moji-review-data.py --fetch</code>。脚本只读取你的 MOJi 复习记录，不会修改 MOJi 数据，也不会把登录凭据写入导出文件。</li>
              <li>桌面会生成 <code>master-nihongo-moji-review-export.json</code>；将它 AirDrop 到 iPhone，或存入“文件”。</li>
              <li>回到本页点“导入词单或 MOJi 复习记录”，选择该 JSON 并确认。不要选择 .realm、.db 或缓存文件。</li>
            </ol>
            <p className="mt-2 text-white/45">导入会把 Moji 的做题次数、错误次数和分数转换为本应用的复习强度，不会覆盖已有本机学习记录。Windows 或纯 iPhone 目前只能导入已经导出的 JSON，不能生成这份完整记录。</p>
          </div>

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
                    将清除本机学习数据库、每日目标、筛选偏好，并恢复到内置初始词库。建议先导出学习数据。
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
            <span className="font-bold text-white">{formatBytes(storageInfo.database)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">偏好与筛选</span>
            <span className="font-bold text-white">{formatBytes(storageInfo.local)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">缓存文件</span>
            <span className="font-bold text-white">{formatBytes(storageInfo.cache)}</span>
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
