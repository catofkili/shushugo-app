import { ArrowLeft, Check, Crown, ReceiptText, Shield, Smartphone, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useEntitlements } from "../hooks/useEntitlements";
import { productLabel } from "../lib/entitlements";
import { clearLocalPasscode, getPasscodeState, setLocalPasscode, type PasscodeState } from "../lib/localPasscode";
import { getCloudSession, type CloudSession } from "../lib/sync-api";

interface AccountSecurityProps {
  onBack: () => void;
}

export function AccountSecurity({ onBack }: AccountSecurityProps) {
  const entitlements = useEntitlements();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [passcodeState, setPasscodeState] = useState<PasscodeState>({ enabled: false });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false });

  useEffect(() => {
    let alive = true;
    getPasscodeState().then((state) => {
      if (alive) setPasscodeState(state);
    });
    getCloudSession().then((session) => {
      if (alive) setCloudSession(session);
    });
    return () => {
      alive = false;
    };
  }, []);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const finishSuccess = (text: string) => {
    setMessage(text);
    setShowSuccess(true);
    resetForm();
    window.setTimeout(() => setShowSuccess(false), 2000);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的口令不一致。");
      return;
    }
    setSaving(true);
    try {
      const state = await setLocalPasscode(currentPassword, newPassword);
      setPasscodeState(state);
      finishSuccess(passcodeState.enabled ? "本地口令已修改。" : "本地口令已启用。");
      setShowChangePassword(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本地口令保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleClearPasscode = async () => {
    if (passcodeState.enabled && !currentPassword) {
      setMessage("请输入当前口令后再关闭。");
      return;
    }
    setSaving(true);
    try {
      const state = await clearLocalPasscode(currentPassword);
      setPasscodeState(state);
      finishSuccess("本地访问口令已关闭。");
      setShowChangePassword(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关闭本地口令失败。");
    } finally {
      setSaving(false);
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
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">账号和安全</p>
      </div>

      {/* 账号信息 */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <User size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/50">账号</p>
              <p className="mt-1 truncate text-sm font-bold text-white">
                {cloudSession.token && cloudSession.email ? cloudSession.email : "本机模式（无需注册）"}
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <Crown size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/50">会员权益</p>
              <p className="mt-1 text-sm font-bold text-white">{entitlements.isPro ? productLabel(entitlements.productId) : "免费版"}</p>
            </div>
            <span className="rounded-full bg-[#81D8CF]/20 px-2 py-1 text-xs font-bold text-[#81D8CF]">
              {entitlements.isPro ? "已启用" : "未购买"}
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
              <ReceiptText size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/50">购买通道</p>
              <p className="mt-1 text-sm font-bold text-white/60">Apple App Store 内购</p>
            </div>
          </div>
        </div>
      </div>

      {/* 密码和安全 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">密码和安全</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <button
            onClick={() => setShowChangePassword(!showChangePassword)}
            className="focus-ring flex w-full items-center gap-3 p-4 text-left hover:bg-[#4d5151]"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#3b3f3f] text-white/76">
              <Shield size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">本地访问口令</p>
              <p className="mt-0.5 text-xs text-white/50">
                {passcodeState.enabled ? "已启用，修改或关闭前需要校验当前口令" : "可为本机资料设置独立访问口令"}
              </p>
            </div>
            <span className="rounded-full bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-[#81D8CF]">
              {passcodeState.enabled ? "已开启" : "未开启"}
            </span>
          </button>
        </div>
      </div>

      {/* 修改密码表单 */}
      {showChangePassword && (
        <div className="mb-4 space-y-3 rounded-2xl border border-white/15 bg-[#464949] p-4">
          <h3 className="text-sm font-bold text-white">设置本地访问口令</h3>

          <div>
            <label className="mb-1 block text-xs text-white/60">
              {passcodeState.enabled ? "当前口令" : "当前口令（首次设置可留空）"}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
              placeholder={passcodeState.enabled ? "请输入当前口令" : "首次设置不用填写"}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/60">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
              placeholder="请输入新口令（至少8位）"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/60">确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white placeholder:text-white/40"
              placeholder="再次输入新密码"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleChangePassword}
              disabled={saving || (passcodeState.enabled && !currentPassword) || !newPassword || !confirmPassword}
              className="focus-ring flex-1 rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold text-[#343838] hover:bg-white disabled:opacity-50"
            >
              {saving ? "保存中" : passcodeState.enabled ? "确认修改" : "启用口令"}
            </button>
            <button
              onClick={() => {
                setShowChangePassword(false);
                resetForm();
              }}
              className="focus-ring rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white/78 hover:bg-white/8"
            >
              取消
            </button>
          </div>

          {passcodeState.enabled && (
            <button
              onClick={handleClearPasscode}
              disabled={saving || !currentPassword}
              className="focus-ring w-full rounded-2xl border border-white/20 px-4 py-2 text-sm font-bold text-white/78 hover:bg-white/8 disabled:opacity-50"
            >
              关闭本地访问口令
            </button>
          )}

          {message && (
            <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-sm ${showSuccess ? "bg-[#81D8CF]/20 text-[#81D8CF]" : "bg-white/8 text-white/70"}`}>
              {showSuccess && <Check size={16} />}
              {message}
            </div>
          )}
        </div>
      )}

      {/* 当前设备 */}
      <div>
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">当前设备</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
                <Smartphone size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">
                  {Capacitor.getPlatform() === "ios" ? "本机（iOS）" : "本机（浏览器）"}
                </p>
                <p className="mt-0.5 text-xs text-white/50">学习数据保存在本机，可在设置中导出备份</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="mt-4 rounded-2xl border border-[#81D8CF]/20 bg-[#81D8CF]/20 p-3 text-xs text-[#81D8CF]">
        <p className="font-bold">本地账号模式</p>
        <p className="mt-1 text-[#81D8CF]/70">
          当前不要求注册邮箱或手机号。付费权益通过 Apple 内购恢复，学习数据继续保存在本机。
        </p>
      </div>
    </div>
  );
}
