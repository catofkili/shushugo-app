import { Apple, ArrowLeft, Check, Crown, KeyRound, ReceiptText, Shield, Smartphone, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useEntitlements } from "../hooks/useEntitlements";
import { productLabel } from "../lib/entitlements";
import { clearLocalPasscode, getPasscodeState, setLocalPasscode, type PasscodeState } from "../lib/localPasscode";
import { changeCloudPassword, deleteCloudAccount, getCloudAuthConfig, linkCloudApple, type CloudSession } from "../lib/sync-api";
import { requestAppleCredential } from "../lib/apple-auth";

interface AccountSecurityProps {
  onBack: () => void;
  cloudSession: CloudSession;
}

export function AccountSecurity({ onBack, cloudSession }: AccountSecurityProps) {
  const entitlements = useEntitlements();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [passcodeState, setPasscodeState] = useState<PasscodeState>({ enabled: false });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountConfirmPassword, setAccountConfirmPassword] = useState("");
  const [deletePanelOpen, setDeletePanelOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  useEffect(() => {
    let alive = true;
    getPasscodeState().then((state) => {
      if (alive) setPasscodeState(state);
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

  const handleAccountPassword = async () => {
    if (accountNewPassword !== accountConfirmPassword) return setMessage("两次输入的新密码不一致。");
    setSaving(true);
    try {
      setMessage(await changeCloudPassword(accountCurrentPassword, accountNewPassword));
      setShowSuccess(true);
      setShowAccountPassword(false);
      setAccountCurrentPassword("");
      setAccountNewPassword("");
      setAccountConfirmPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号密码修改失败。");
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async () => {
    if (!window.confirm("确定永久删除账号吗？云端资料和备份将无法恢复，本机学习数据会保留。")) return;
    setSaving(true);
    try {
      if (cloudSession.authProviders?.includes("email")) {
        await deleteCloudAccount(deletePassword);
      } else {
        const config = await getCloudAuthConfig();
        const credential = await requestAppleCredential(config);
        await deleteCloudAccount("", credential);
      }
      onBack();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号删除失败。");
    } finally {
      setSaving(false);
    }
  };

  const connectApple = async () => {
    setSaving(true);
    setMessage("");
    try {
      const config = await getCloudAuthConfig();
      const credential = await requestAppleCredential(config);
      await linkCloudApple(credential);
      finishSuccess("Apple 登录已关联。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Apple 登录关联失败。");
    } finally {
      setSaving(false);
    }
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
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#91C968]/20 text-[#B7E38D]">
              <User size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/50">账号</p>
              <p className="mt-1 truncate text-sm font-bold text-white">
                {cloudSession.email}
              </p>
              <p className="mt-1 text-xs text-white/45">
                登录方式：{cloudSession.authProviders?.map((provider) => provider === "apple" ? "Apple" : provider === "wechat" ? "微信" : "邮箱密码").join("、") || "邮箱密码"}
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#91C968]/20 text-[#B7E38D]">
              <Crown size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/50">会员权益</p>
              <p className="mt-1 text-sm font-bold text-white">{entitlements.isPro ? productLabel(entitlements.productId) : "免费版"}</p>
            </div>
            <span className="rounded-full bg-[#91C968]/20 px-2 py-1 text-xs font-bold text-[#B7E38D]">
              {entitlements.isPro ? "已启用" : "未购买"}
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#91C968]/20 text-[#B7E38D]">
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
          {cloudSession.authProviders?.includes("email") && (
            <button onClick={() => setShowAccountPassword((value) => !value)} className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151]">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#91C968]/16 text-[#B7E38D]"><KeyRound size={20} /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-bold text-white">账号密码</p><p className="mt-0.5 text-xs text-white/50">修改邮箱登录所使用的密码</p></div>
            </button>
          )}
          {cloudSession.authProviders?.includes("apple") && (
            <div className="flex w-full items-center gap-3 border-b border-white/10 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-black"><Apple size={20} fill="currentColor" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-bold text-white">Apple 登录</p><p className="mt-0.5 text-xs text-white/50">已关联，可使用 Face ID 或 Apple 账号登录</p></div>
              <span className="text-xs font-bold text-[#B7E38D]">已关联</span>
            </div>
          )}
          {!cloudSession.authProviders?.includes("apple") && (
            <button
              onClick={() => void connectApple()}
              disabled={saving}
              className="focus-ring flex w-full items-center gap-3 border-b border-white/10 p-4 text-left hover:bg-[#4d5151] disabled:opacity-50"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-black"><Apple size={20} fill="currentColor" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-bold text-white">关联 Apple 登录</p><p className="mt-0.5 text-xs text-white/50">关联后可使用 Face ID 或 Apple 账号登录</p></div>
            </button>
          )}
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
            <span className="rounded-full bg-[#91C968]/15 px-2 py-1 text-xs font-bold text-[#B7E38D]">
              {passcodeState.enabled ? "已开启" : "未开启"}
            </span>
          </button>
        </div>
      </div>

      {showAccountPassword && (
        <div className="mb-4 space-y-3 rounded-2xl border border-white/15 bg-[#464949] p-4">
          <h3 className="text-sm font-bold text-white">修改账号密码</h3>
          <input type="password" autoComplete="current-password" value={accountCurrentPassword} onChange={(event) => setAccountCurrentPassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white" placeholder="当前账号密码" />
          <input type="password" autoComplete="new-password" value={accountNewPassword} onChange={(event) => setAccountNewPassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white" placeholder="新密码（至少 8 位）" />
          <input type="password" autoComplete="new-password" value={accountConfirmPassword} onChange={(event) => setAccountConfirmPassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/20 bg-[#3c3f3f] px-3 py-2 text-sm text-white" placeholder="再次输入新密码" />
          <button onClick={() => void handleAccountPassword()} disabled={saving || !accountCurrentPassword || accountNewPassword.length < 8 || !accountConfirmPassword} className="focus-ring w-full rounded-2xl bg-[#91C968] px-4 py-2 text-sm font-bold text-[#172112] disabled:opacity-50">确认修改</button>
        </div>
      )}

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
              className="focus-ring flex-1 rounded-2xl bg-[#91C968] px-4 py-2 text-sm font-bold text-[#172112] hover:bg-[#A6D77F] disabled:opacity-50"
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

        </div>
      )}

      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-2xl px-3 py-2 text-sm ${showSuccess ? "bg-[#91C968]/20 text-[#B7E38D]" : "bg-white/8 text-white/70"}`} role="status">
          {showSuccess && <Check size={16} />}
          {message}
        </div>
      )}

      {/* 当前设备 */}
      <div className="mb-4">
        <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-white/45">当前设备</p>
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#464949]">
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#91C968]/20 text-[#B7E38D]">
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

      <div className="overflow-hidden rounded-2xl border border-red-300/20 bg-[#464949]">
        <button onClick={() => setDeletePanelOpen((value) => !value)} className="focus-ring flex w-full items-center gap-3 p-4 text-left text-red-200 hover:bg-red-400/10">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-red-400/12"><Trash2 size={20} /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-bold">删除账号</p><p className="mt-0.5 text-xs text-red-100/55">永久删除账号资料和云端备份</p></div>
        </button>
        {deletePanelOpen && (
          <div className="border-t border-red-300/15 p-4">
            {cloudSession.authProviders?.includes("email") ? (
              <input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-red-300/25 bg-[#3c3f3f] px-3 py-2 text-sm text-white" placeholder="输入账号密码确认" />
            ) : (
              <p className="text-xs leading-5 text-white/55">继续后会调用 Apple 登录重新验证身份。</p>
            )}
            <button onClick={() => void removeAccount()} disabled={saving || (Boolean(cloudSession.authProviders?.includes("email")) && deletePassword.length < 8)} className="focus-ring mt-3 w-full rounded-2xl bg-red-400 px-4 py-2 text-sm font-bold text-red-950 disabled:opacity-50">永久删除账号</button>
          </div>
        )}
      </div>

      {/* 提示信息 */}
      <div className="mt-4 rounded-2xl border border-[#91C968]/20 bg-[#91C968]/12 p-3 text-xs text-[#B7E38D]">
        <p className="font-bold">账号与离线学习</p>
        <p className="mt-1 text-white/55">
          退出账号后仍可离线学习；重新登录后会继续同步本机产生的新进度。
        </p>
      </div>
    </div>
  );
}
