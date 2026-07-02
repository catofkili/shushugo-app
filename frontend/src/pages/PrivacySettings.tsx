import { AlertTriangle, ArrowLeft, ChevronRight, Database, Cloud, Trash2 } from "lucide-react";
import { useState } from "react";
import { exportDatabase } from "../lib/database";
import { clearEntitlements } from "../lib/entitlements";
import { getPasscodeState, verifyPasscode } from "../lib/localPasscode";
import { clearStorage } from "../lib/storage";

interface PrivacySettingsProps {
  onBack: () => void;
  onOpenPolicy: () => void;
}

export function PrivacySettings({ onBack, onOpenPolicy }: PrivacySettingsProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [clearPanelOpen, setClearPanelOpen] = useState(false);
  const [clearRequiresPasscode, setClearRequiresPasscode] = useState(false);
  const [clearCredential, setClearCredential] = useState("");
  const [clearingData, setClearingData] = useState(false);
  const clearConfirmText = "删除所有数据";

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
      } else if (clearCredential !== clearConfirmText) {
        notify(`请输入「${clearConfirmText}」后再删除。`);
        return;
      }

      await clearStorage();
      localStorage.removeItem("mn-study-preferences");
      localStorage.removeItem("mn-word-level");
      localStorage.removeItem("mn-word-type");
      localStorage.removeItem("jp-grammar-card-order-v2");
      clearEntitlements();
      notify("本机数据已删除，页面即将刷新。");
      window.setTimeout(() => window.location.reload(), 900);
    } finally {
      setClearingData(false);
    }
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
              <p className="mt-0.5 text-xs text-white/50">当前版本仅使用本机数据，跨设备同步暂未开放</p>
            </div>
            <span className="rounded-full border border-white/15 bg-white/8 px-2 py-1 text-xs font-bold text-white/55">
              暂未开放
            </span>
          </div>
        </div>
      </div>

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

          <button onClick={openClearDataPanel} className="focus-ring flex w-full items-center gap-3 p-4 text-left text-red-200 hover:bg-red-500/12">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-500/16 text-red-200">
              <Trash2 size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">删除所有数据</p>
              <p className="mt-0.5 text-xs text-red-100/60">永久删除学习记录</p>
            </div>
            <ChevronRight size={17} className="text-red-100/40" />
          </button>
          {clearPanelOpen && (
            <div className="border-t border-red-300/20 bg-red-950/25 p-4">
              <div className="flex items-start gap-3 rounded-2xl border border-red-300/25 bg-red-500/12 p-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-200" />
                <div>
                  <p className="text-sm font-bold text-red-100">红色警告：删除后不可撤销</p>
                  <p className="mt-1 text-xs leading-5 text-red-100/65">
                    会删除本机学习进度、收藏、设置和本地权益记录。建议先下载数据备份。
                  </p>
                </div>
              </div>
              <label className="mt-3 block text-xs font-bold text-red-100/75">
                {clearRequiresPasscode ? "输入本地访问口令确认" : `输入「${clearConfirmText}」确认`}
              </label>
              <input
                type={clearRequiresPasscode ? "password" : "text"}
                value={clearCredential}
                onChange={(event) => setClearCredential(event.target.value)}
                className="focus-ring mt-2 w-full rounded-2xl border border-red-300/30 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/35"
                placeholder={clearRequiresPasscode ? "本地访问口令" : clearConfirmText}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={clearData}
                  disabled={clearingData || !clearCredential}
                  className="focus-ring rounded-2xl bg-red-400 px-3 py-2 text-sm font-bold text-red-950 hover:bg-red-300 disabled:opacity-50"
                >
                  {clearingData ? "删除中" : "确认删除"}
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
        <div className="mb-4 rounded-2xl border border-white/15 bg-white/8 p-3 text-xs font-bold text-white/72">
          {message}
        </div>
      )}

      {/* 说明 */}
      <div className="rounded-2xl border border-[#81D8CF]/20 bg-[#81D8CF]/20 p-3 text-xs text-[#81D8CF]">
        <p className="font-bold">我们重视您的隐私</p>
        <p className="mt-1 text-[#81D8CF]/70">
          当前版本的学习数据默认保存在本地设备。导出备份后，请妥善保管备份文件。
        </p>
      </div>
    </div>
  );
}
