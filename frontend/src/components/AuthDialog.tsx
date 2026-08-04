import { Apple, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { requestAppleCredential } from "../lib/apple-auth";
import {
  cloudAppleLogin,
  cloudLogin,
  cloudRegister,
  getCloudApiUrl,
  getCloudAuthConfig,
  isCloudErrorCode,
  linkCloudApple,
  requestCloudPasswordReset,
  resetCloudPassword,
  type AppleLoginCredential,
  type CloudAuthConfig,
  type CloudSession
} from "../lib/sync-api";
import { PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_TITLE } from "../lib/privacy-policy-content";
import { USER_AGREEMENT_EFFECTIVE_DATE, USER_AGREEMENT_SECTIONS, USER_AGREEMENT_TITLE } from "../lib/user-agreement-content";

type AuthMode = "login" | "register" | "reset" | "apple-consent" | "terms" | "privacy" | "success";
type TurnstileAction = "register" | "login" | "password_reset";

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (session: CloudSession) => void | Promise<void>;
}

function TurnstileFrame({ action, onToken }: { action: TurnstileAction; onToken: (token: string) => void }) {
  const apiUrl = getCloudApiUrl();
  const source = `${apiUrl}/auth/challenge?action=${encodeURIComponent(action)}`;
  useEffect(() => {
    const expectedOrigin = new URL(apiUrl).origin;
    const receive = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.data?.type !== "mn-turnstile" || event.data?.action !== action) return;
      onToken(typeof event.data.token === "string" ? event.data.token : "");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [action, apiUrl, onToken]);
  return (
    <iframe
      title="人机验证"
      src={source}
      className="h-[76px] w-full rounded-2xl border-0 bg-transparent"
      sandbox="allow-scripts allow-forms allow-same-origin"
    />
  );
}

export function AuthDialog({ open, onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [returnMode, setReturnMode] = useState<AuthMode>("login");
  const [config, setConfig] = useState<CloudAuthConfig>({ appleEnabled: false, turnstileEnabled: false });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [consented, setConsented] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [turnstileAction, setTurnstileAction] = useState<TurnstileAction | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [pendingApple, setPendingApple] = useState<AppleLoginCredential | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    void getCloudAuthConfig()
      .then(setConfig)
      .catch((error) => setMessage(error instanceof Error ? error.message : "无法读取登录配置。"));
  }, [open]);

  useEffect(() => {
    setTurnstileToken("");
    if (mode === "register" && config.turnstileEnabled) setTurnstileAction("register");
    else if (mode === "reset" && config.turnstileEnabled) setTurnstileAction("password_reset");
    else if (mode !== "login") setTurnstileAction(null);
  }, [config.turnstileEnabled, mode]);

  const title = useMemo(() => ({
    login: "登录 Master 账号",
    register: "创建 Master 账号",
    reset: "重置密码",
    "apple-consent": "完成 Apple 账号创建",
    terms: USER_AGREEMENT_TITLE,
    privacy: PRIVACY_POLICY_TITLE,
    success: "设置完成"
  }[mode]), [mode]);

  if (!open) return null;

  const finish = async (session: CloudSession) => {
    await onAuthenticated(session);
    setMode("success");
    setMessage("已登录，正在同步账号资料和学习进度。");
    window.setTimeout(onClose, 650);
  };

  const handleError = (error: unknown) => {
    if (isCloudErrorCode(error, "TURNSTILE_REQUIRED")) {
      setTurnstileAction("login");
      setTurnstileToken("");
    }
    setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。");
  };

  const login = async () => {
    setBusy(true);
    setMessage("");
    try {
      let session = await cloudLogin(email, password, turnstileToken || undefined);
      if (pendingApple) {
        session = await linkCloudApple(pendingApple);
        setPendingApple(null);
      }
      await finish(session);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!consented) return setMessage("请先阅读并同意用户协议和隐私政策。");
    if (password !== confirmPassword) return setMessage("两次输入的密码不一致。");
    setBusy(true);
    setMessage("");
    try {
      await finish(await cloudRegister(email, password, nickname, turnstileToken || undefined));
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const appleLogin = async (credential?: AppleLoginCredential) => {
    setBusy(true);
    setMessage("");
    let nextCredential = credential;
    try {
      nextCredential = credential ?? await requestAppleCredential(config);
      const session = await cloudAppleLogin(nextCredential);
      await finish(session);
    } catch (error) {
      if (isCloudErrorCode(error, "CONSENT_REQUIRED") && nextCredential) {
        setPendingApple(nextCredential);
        setMode("apple-consent");
        setMessage("首次使用 Apple 登录，请确认协议后创建账号。");
      } else if (isCloudErrorCode(error, "ACCOUNT_LINK_REQUIRED")) {
        const apple = nextCredential ?? pendingApple;
        if (apple) setPendingApple(apple);
        const existingEmail = error instanceof Error && "data" in error
          ? String((error as { data?: { email?: string } }).data?.email ?? "")
          : "";
        if (existingEmail) setEmail(existingEmail);
        setMode("login");
        setMessage("该邮箱已有账号。请先用邮箱密码登录，成功后会自动关联 Apple 登录。");
      } else {
        handleError(error);
      }
    } finally {
      setBusy(false);
    }
  };

  const continueAppleCreation = async () => {
    if (!consented || !pendingApple) return setMessage("请先阅读并同意用户协议和隐私政策。");
    await appleLogin({ ...pendingApple, displayName: nickname || pendingApple.displayName, consentAccepted: true });
  };

  const sendResetCode = async () => {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await requestCloudPasswordReset(email, turnstileToken || undefined));
      setTurnstileToken("");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await resetCloudPassword(email, resetCode, newPassword));
      setPassword("");
      setMode("login");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const openLegal = (next: "terms" | "privacy") => {
    setReturnMode(mode);
    setMode(next);
  };

  const legalSections = mode === "terms" ? USER_AGREEMENT_SECTIONS : PRIVACY_POLICY_SECTIONS;
  const legalDate = mode === "terms" ? USER_AGREEMENT_EFFECTIVE_DATE : PRIVACY_POLICY_EFFECTIVE_DATE;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#101810]/70 p-3 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className="flex max-h-[78dvh] w-[92vw] flex-col overflow-hidden rounded-[28px] border border-[#B7E38D]/35 bg-[#303730] shadow-[0_28px_90px_rgba(0,0,0,.5)] sm:w-[60vw] sm:max-w-[840px]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          {(mode === "terms" || mode === "privacy") && (
            <button onClick={() => setMode(returnMode)} className="focus-ring grid h-10 w-10 place-items-center rounded-2xl text-white/75 hover:bg-white/10" aria-label="返回">
              <ArrowLeft size={19} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#B7E38D]">Master Nihongo</p>
            <h2 id="auth-dialog-title" className="mt-0.5 truncate text-lg font-bold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="focus-ring grid h-10 w-10 place-items-center rounded-2xl text-white/70 hover:bg-white/10" aria-label="关闭登录窗口">
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {(mode === "terms" || mode === "privacy") ? (
            <div className="space-y-4 pb-2">
              <p className="text-xs font-bold text-[#B7E38D]">生效日期：{legalDate}</p>
              {legalSections.map((section) => (
                <section key={section.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-bold text-white">{section.title}</h3>
                  {section.body.map((line) => <p key={line} className="mt-2 text-sm leading-6 text-white/65">{line}</p>)}
                </section>
              ))}
            </div>
          ) : mode === "success" ? (
            <div className="grid min-h-[240px] place-items-center text-center">
              <div>
                <CheckCircle2 size={48} className="mx-auto text-[#91C968]" />
                <p className="mt-4 text-base font-bold text-white">登录成功</p>
                <p className="mt-2 text-sm text-white/55">{message}</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[480px] space-y-4">
              {mode === "login" && (
                <>
                  <p className="text-sm leading-6 text-white/58">登录后可跨设备同步学习进度和个人资料；不登录也能继续离线学习。</p>
                  <button
                    onClick={() => void appleLogin()}
                    disabled={busy || !config.appleEnabled}
                    className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-white/90 disabled:opacity-45"
                  >
                    <Apple size={20} fill="currentColor" />
                    {config.appleEnabled ? "使用 Apple 登录" : "Apple 登录待服务端配置"}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-white/35"><span className="h-px flex-1 bg-white/12" />或使用邮箱<span className="h-px flex-1 bg-white/12" /></div>
                </>
              )}

              {(mode === "login" || mode === "register" || mode === "reset") && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-white/62">邮箱</span>
                  <span className="flex items-center gap-2 rounded-2xl border border-white/16 bg-[#242a24] px-3">
                    <Mail size={17} className="text-[#91C968]" />
                    <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/30" placeholder="name@example.com" />
                  </span>
                </label>
              )}

              {(mode === "login" || mode === "register") && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-white/62">密码</span>
                  <span className="flex items-center gap-2 rounded-2xl border border-white/16 bg-[#242a24] px-3">
                    <LockKeyhole size={17} className="text-[#91C968]" />
                    <input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/30" placeholder="至少 8 位" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-white/50" aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </span>
                </label>
              )}

              {mode === "register" && (
                <>
                  <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/62">确认密码</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/16 bg-[#242a24] px-3 py-3 text-sm text-white" /></label>
                  <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/62">昵称</span><input value={nickname} maxLength={20} onChange={(event) => setNickname(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/16 bg-[#242a24] px-3 py-3 text-sm text-white" placeholder="1–20 个字符" /></label>
                </>
              )}

              {mode === "apple-consent" && (
                <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/62">昵称（可修改）</span><input value={nickname || pendingApple?.displayName || ""} maxLength={20} onChange={(event) => setNickname(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/16 bg-[#242a24] px-3 py-3 text-sm text-white" /></label>
              )}

              {mode === "reset" && (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-2"><input inputMode="numeric" value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="focus-ring rounded-2xl border border-white/16 bg-[#242a24] px-3 py-3 text-sm text-white" placeholder="6 位验证码" /><button onClick={() => void sendResetCode()} disabled={busy || !email || (config.turnstileEnabled && !turnstileToken)} className="focus-ring rounded-2xl border border-[#91C968]/35 px-3 text-xs font-bold text-[#B7E38D] disabled:opacity-45">发送验证码</button></div>
                  <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="focus-ring w-full rounded-2xl border border-white/16 bg-[#242a24] px-3 py-3 text-sm text-white" placeholder="新密码（至少 8 位）" />
                </>
              )}

              {(mode === "register" || mode === "apple-consent") && (
                <label className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-white/58">
                  <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="peer sr-only" />
                  <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-[#B7E38D]/55 bg-[#202720] text-[#172112] peer-checked:bg-[#91C968]">
                    {consented && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span>我已阅读并同意 <button type="button" onClick={() => openLegal("terms")} className="font-bold text-[#B7E38D]">《用户协议》</button> 和 <button type="button" onClick={() => openLegal("privacy")} className="font-bold text-[#B7E38D]">《隐私政策》</button></span>
                </label>
              )}

              {turnstileAction && <TurnstileFrame key={`${mode}-${turnstileAction}`} action={turnstileAction} onToken={setTurnstileToken} />}

              {message && <div className="rounded-2xl border border-[#91C968]/20 bg-[#91C968]/10 p-3 text-xs leading-5 text-white/72">{message}</div>}

              {mode === "login" && <button onClick={() => void login()} disabled={busy || !email || !password || (turnstileAction === "login" && !turnstileToken)} className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-[#91C968] px-4 py-3 text-sm font-bold text-[#172112] disabled:opacity-45">{busy && <LoaderCircle size={17} className="animate-spin" />}登录</button>}
              {mode === "register" && <button onClick={() => void register()} disabled={busy || !email || password.length < 8 || !nickname || (config.turnstileEnabled && !turnstileToken)} className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-[#91C968] px-4 py-3 text-sm font-bold text-[#172112] disabled:opacity-45">{busy && <LoaderCircle size={17} className="animate-spin" />}创建账号</button>}
              {mode === "apple-consent" && <button onClick={() => void continueAppleCreation()} disabled={busy || !consented} className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-[#91C968] px-4 py-3 text-sm font-bold text-[#172112] disabled:opacity-45"><ShieldCheck size={18} />同意并创建账号</button>}
              {mode === "reset" && <button onClick={() => void resetPassword()} disabled={busy || resetCode.length !== 6 || newPassword.length < 8} className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-[#91C968] px-4 py-3 text-sm font-bold text-[#172112] disabled:opacity-45">确认重置密码</button>}

              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-white/55">
                {mode === "login" && <><button onClick={() => { setMode("register"); setMessage(""); }}>创建邮箱账号</button><button onClick={() => { setMode("reset"); setMessage(""); }}>忘记密码</button></>}
                {(mode === "register" || mode === "reset" || mode === "apple-consent") && <button onClick={() => { setMode("login"); setMessage(""); }}>返回登录</button>}
                {mode === "login" && <><button onClick={() => openLegal("terms")}>用户协议</button><button onClick={() => openLegal("privacy")}>隐私政策</button></>}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
