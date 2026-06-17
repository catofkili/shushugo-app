import { Check, ChevronRight, Download, Moon, RotateCcw, Smartphone, Sun, Upload, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refreshTodayWordPlan } from "../lib/api";
import { exportDatabase, importDatabase } from "../lib/database";
import { clearStorage, saveDatabase } from "../lib/storage";
import {
  applyTheme,
  defaultStudyPreferences,
  getStudyPreferences,
  saveStudyPreferences,
  StudyPreferences,
  ThemePreference
} from "../lib/studyPreferences";
import { getDatabase } from "../lib/database";

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
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Smartphone }
];

export function SettingsPage({ onBack: _onBack }: SettingsPageProps) {
  const [preferences, setPreferences] = useState<StudyPreferences>(defaultStudyPreferences);
  const [storageInfo, setStorageInfo] = useState({ database: 0, local: 0, cache: 0 });
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setPreferences(getStudyPreferences());
    refreshStorageInfo();
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
    const next = updatePreference({ dailyGoal: value }, "每日目标已保存。");
    try {
      refreshTodayWordPlan();
      notify(`每日目标已改为 ${next.dailyGoal} 个。`);
    } catch {
      notify("每日目标已保存，重启应用后生效。");
    }
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
      await importDatabase(new Uint8Array(buffer));
      await saveDatabase();
      notify("学习数据已恢复，页面即将刷新。");
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      notify("导入失败，请确认文件是 Master Nihongo 备份。");
    }
  };

  const clearData = async () => {
    const confirmed = window.confirm("确定要清除本机保存的学习数据吗？应用会回到内置初始词库。");
    if (!confirmed) return;
    await clearStorage();
    localStorage.removeItem("mn-study-preferences");
    localStorage.removeItem("mn-word-level");
    localStorage.removeItem("mn-word-type");
    notify("本机学习数据和偏好已清除，页面即将刷新。");
    window.setTimeout(() => window.location.reload(), 900);
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
            <p className="mt-3 text-xs text-white/50">主题会立即生效并自动保存</p>
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

          <div className="p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-white">每日学习目标</p>
              <p className="mt-0.5 text-xs text-white/50">当天没开始做题时会立即刷新今日计划</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={preferences.dailyGoal}
                onChange={(event) => updateDailyGoal(Number(event.target.value))}
                className="flex-1"
              />
              <span className="min-w-[3.5rem] text-right text-sm font-bold text-[#81D8CF]">
                {preferences.dailyGoal} 个
              </span>
            </div>

            {/* 目标完成时间预测 */}
            <GoalEstimation dailyGoal={preferences.dailyGoal} />
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">数据管理</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
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

          <button onClick={() => fileInputRef.current?.click()} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/16 text-[#81D8CF]">
              <Upload size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">导入学习数据</p>
              <p className="mt-0.5 text-xs text-white/50">从文件恢复进度</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,application/octet-stream"
            className="hidden"
            onChange={(event) => importData(event.target.files?.[0] ?? null)}
          />

          <button onClick={clearData} className="focus-ring flex w-full items-center gap-3 p-4 text-left text-[#81D8CF] hover:bg-[#81D8CF]/20">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/16 text-[#81D8CF]">
              <RotateCcw size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">清除所有数据</p>
              <p className="mt-0.5 text-xs text-[#81D8CF]/60">会删除学习进度和本机偏好</p>
            </div>
            <ChevronRight size={17} className="text-[#81D8CF]/40" />
          </button>
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
