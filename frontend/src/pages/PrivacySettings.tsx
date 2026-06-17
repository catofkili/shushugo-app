import { ArrowLeft, ChevronRight, Database, Cloud, Trash2 } from "lucide-react";
import { useState } from "react";
import { exportDatabase } from "../lib/database";
import { clearEntitlements } from "../lib/entitlements";
import { clearStorage } from "../lib/storage";

interface PrivacySettingsProps {
  onBack: () => void;
  onOpenPolicy: () => void;
}

export function PrivacySettings({ onBack, onOpenPolicy }: PrivacySettingsProps) {
  const [cloudSync, setCloudSync] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [message, setMessage] = useState("");

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2200);
  };

  const exportData = () => {
    const data = exportDatabase();
    if (!data) {
      notify("当前没有可导出的学习数据库。");
      return;
    }
    const backupBytes = new Uint8Array(data);
    const blob = new Blob([backupBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `master-nihongo-privacy-export-${new Date().toISOString().slice(0, 10)}.db`;
    link.click();
    URL.revokeObjectURL(url);
    notify("本机学习数据已导出。");
  };

  const clearData = async () => {
    const confirmed = window.confirm("确定要删除本机学习数据吗？这会清空进度、收藏、错题和设置，并恢复到初始状态。");
    if (!confirmed) return;
    await clearStorage();
    localStorage.removeItem("mn-study-preferences");
    localStorage.removeItem("mn-word-level");
    localStorage.removeItem("mn-word-type");
    localStorage.removeItem("jp-grammar-card-order-v2");
    clearEntitlements();
    notify("本机数据已删除，页面即将刷新。");
    window.setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">隐私</p>
      </div>

      {/* 数据存储 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">数据存储</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <Database size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">本地存储</p>
              <p className="mt-0.5 text-xs text-white/50">数据保存在设备上</p>
            </div>
            <span className="rounded-full bg-[#81D8CF]/20 px-2 py-1 text-xs font-bold text-[#81D8CF]">
              已启用
            </span>
          </div>

          <div className="flex items-center gap-3 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <Cloud size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">云端同步</p>
              <p className="mt-0.5 text-xs text-white/50">跨设备同步学习进度</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={cloudSync}
                onChange={(e) => setCloudSync(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>
        </div>
      </div>

      {cloudSync && (
        <div className="mb-4 rounded-2xl border border-[#81D8CF]/20 bg-[#81D8CF]/20 p-3 text-xs text-[#81D8CF]">
          <p className="font-bold">⚠️ 云端同步功能开发中</p>
          <p className="mt-1 text-[#81D8CF]/70">
            云端同步需要后端服务器支持。请参考 backend/README.md 部署后端。
          </p>
        </div>
      )}

      {/* 隐私权限 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">隐私权限</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">使用分析</p>
              <p className="mt-0.5 text-xs text-white/50">当前未接入第三方分析服务</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => {
                  setAnalyticsEnabled(e.target.checked);
                  notify(e.target.checked ? "当前只是本机偏好开关，尚未上传分析数据。" : "已关闭使用分析偏好。");
                }}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-white/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#81D8CF] peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          <button onClick={onOpenPolicy} className="focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">隐私政策</p>
              <p className="mt-0.5 text-xs text-white/50">查看完整隐私条款</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">数据管理</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <button onClick={exportData} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">下载我的数据</p>
              <p className="mt-0.5 text-xs text-white/50">导出所有个人数据</p>
            </div>
            <ChevronRight size={17} className="text-white/40" />
          </button>

          <button onClick={clearData} className="focus-ring flex w-full items-center gap-3 p-4 text-left text-[#81D8CF] hover:bg-[#81D8CF]/20">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <Trash2 size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">删除所有数据</p>
              <p className="mt-0.5 text-xs text-[#81D8CF]/60">永久删除学习记录</p>
            </div>
            <ChevronRight size={17} className="text-[#81D8CF]/40" />
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-2xl border border-white/15 bg-white/8 p-3 text-xs font-bold text-white/72">
          {message}
        </div>
      )}

      {/* 说明 */}
      <div className="rounded-2xl border border-[#81D8CF]/20 bg-[#81D8CF]/20 p-3 text-xs text-[#81D8CF]">
        <p className="font-bold">🔒 我们重视您的隐私</p>
        <p className="mt-1 text-[#81D8CF]/70">
          所有学习数据默认保存在本地设备。启用云端同步后，数据会加密传输到服务器。
        </p>
      </div>
    </div>
  );
}
