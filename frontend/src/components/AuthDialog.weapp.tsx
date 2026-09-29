import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Check, Loader2, MessageCircle, X } from "lucide-react";
import { ScrollArea } from "./ScrollArea";
import { claimLaunchGift, cloudReviewLogin, cloudWechatMiniLogin, getCloudAuthConfig, isCloudErrorCode, linkCloudWechatMini, refreshLaunchGiftAvailability, requestCloudWechatLinkCode, type CloudSession } from "../lib/sync-api";
import { PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_TITLE } from "../lib/privacy-policy-content";
import { USER_AGREEMENT_EFFECTIVE_DATE, USER_AGREEMENT_SECTIONS, USER_AGREEMENT_TITLE } from "../lib/user-agreement-content";

type Mode = "login" | "review" | "choice" | "create" | "link" | "terms" | "privacy" | "success";

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (session: CloudSession) => void | Promise<void>;
}

const miniCode = (): Promise<string> => new Promise((resolve, reject) => {
  (globalThis as any).wx.login({
    success: (result: { code?: string }) => result.code ? resolve(result.code) : reject(new Error("微信没有返回登录凭证，请重试。")),
    fail: (error: { errMsg?: string }) => reject(new Error(error.errMsg || "微信登录失败，请重试。"))
  });
});

const credentialLabelClass = "block text-xs font-bold text-white/65";
const credentialInputClass = "mt-2 w-full rounded-2xl border border-white/15 bg-[#242a24] px-3 py-3 text-sm text-white";

export function AuthDialog({ open, onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [returnMode, setReturnMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewLoginOpen, setReviewLoginOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) {
      setReviewLoginOpen(false);
      setMode("login");
      return;
    }
    let active = true;
    void getCloudAuthConfig()
      .then((config) => { if (active) setReviewLoginOpen(config.reviewLoginOpen === true); }, () => undefined);
    return () => { active = false; };
  }, [open]);

  // 微信原生 tabBar 在页面渲染树之外，页面层级无法盖住它；登录弹窗打开时临时隐藏。
  useEffect(() => {
    if (!open) return;
    const route = Taro.getCurrentPages().at(-1)?.route;
    if (!route || !/^pages\/(home|word|grammar|profile)\/index$/.test(route)) return;
    void Taro.hideTabBar({ animation: false });
    return () => { void Taro.showTabBar({ animation: false }); };
  }, [open]);

  if (!open) return null;

  const finish = async (session: CloudSession) => {
    await onAuthenticated(session);
    let giftClaimed = false;
    if (session.email !== "review@shushugo.com") {
      try {
        if ((await refreshLaunchGiftAvailability())?.open) {
          giftClaimed = Boolean(await claimLaunchGift());
        }
      } catch { /* login succeeds even if the optional launch gift service is unavailable */ }
    }
    setMode("success");
    setMessage(giftClaimed ? "已登录并领取首月会员，正在同步账号资料和学习进度。" : "已登录，正在同步账号资料和学习进度。");
    setTimeout(onClose, 900);
  };

  const run = async (action: () => Promise<CloudSession>) => {
    setBusy(true);
    setMessage("");
    try {
      await finish(await action());
    } catch (error) {
      if (isCloudErrorCode(error, "WECHAT_ACCOUNT_NOT_FOUND")) {
        setMode("choice");
        setMessage("这个微信还没有收集日账号。请选择创建新账号，或用已有邮箱账号验证并关联。");
      } else {
        const errMsg = typeof error === "object" && error !== null && "errMsg" in error && typeof error.errMsg === "string"
          ? error.errMsg
          : undefined;
        setMessage(error instanceof Error ? error.message : errMsg || "操作失败，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => run(async () => cloudWechatMiniLogin({ code: await miniCode() }));
  const reviewSignIn = () => run(() => cloudReviewLogin("review@shushugo.com", reviewPassword));
  const createAccount = () => {
    if (!consented) return setMessage("请先阅读并同意用户协议和隐私政策。");
    return run(async () => cloudWechatMiniLogin({
      code: await miniCode(),
      createAccount: true,
      displayName: nickname.trim() || undefined,
      consentAccepted: true
    }));
  };
  const sendCode = async () => {
    setBusy(true);
    setMessage("");
    try {
      await requestCloudWechatLinkCode(email);
      setCodeSent(true);
      setMessage("如果该邮箱已注册，验证码已发送；请检查收件箱。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "验证码发送失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };
  const linkAccount = () => {
    if (!consented) return setMessage("请先阅读并同意用户协议和隐私政策。");
    return run(async () => linkCloudWechatMini(email, emailCode, await miniCode(), true));
  };
  const openLegal = (next: "terms" | "privacy") => {
    setReturnMode(mode);
    setMode(next);
  };

  const legal = mode === "terms" ? USER_AGREEMENT_SECTIONS : PRIVACY_POLICY_SECTIONS;
  const title = mode === "terms" ? USER_AGREEMENT_TITLE : mode === "privacy" ? PRIVACY_POLICY_TITLE : "收集日账号";

  return (
    <div className="fixed inset-0 z-[10002] grid place-items-center bg-[#101810]/70 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={title} className={`auth-dialog${mode === "terms" || mode === "privacy" ? " auth-dialog-long" : ""} flex max-h-[82dvh] w-[92vw] flex-col overflow-hidden rounded-[28px] border border-[#B7E38D]/35 bg-[#303730] shadow-[0_28px_90px_rgba(0,0,0,.5)]`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          {mode === "terms" || mode === "privacy" ? <button onClick={() => setMode(returnMode)} className="text-white/70">返回</button> : null}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-[.18em] text-[#B7E38D]">收集日</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center text-white/70" aria-label="关闭登录窗口"><X size={20} /></button>
        </header>

        <ScrollArea className="min-h-0 flex-1 px-4 py-4">
          {(mode === "terms" || mode === "privacy") ? (
            <div className="space-y-3">
              <p className="text-xs text-[#B7E38D]">生效日期：{mode === "terms" ? USER_AGREEMENT_EFFECTIVE_DATE : PRIVACY_POLICY_EFFECTIVE_DATE}</p>
              {legal.map((section) => <section key={section.title} className="rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="text-sm font-bold text-white">{section.title}</h3>{section.body.map((line) => <p key={line} className="mt-2 text-sm leading-6 text-white/65">{line}</p>)}</section>)}
            </div>
          ) : mode === "success" ? (
            <div className="grid min-h-[220px] place-items-center text-center"><div><p className="text-lg font-bold text-white">登录成功</p><p className="mt-2 text-sm text-white/60">{message}</p></div></div>
          ) : (
            <div className="mx-auto max-w-[480px] space-y-4">
              {mode === "login" && <button onClick={() => void signIn()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#07C160] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><MessageCircle size={19} fill="currentColor" />{busy ? "登录中…" : "使用微信登录"}</button>}
              {mode === "login" && reviewLoginOpen && <button onClick={() => { setReviewPassword(""); setMode("review"); setMessage(""); }} className="mx-auto block py-1 text-xs font-bold text-white/45">审核账号登录</button>}
              {mode === "review" && reviewLoginOpen && <>
                <label className={credentialLabelClass}>账号<input value="review@shushugo.com" disabled className={credentialInputClass} /></label>
                <label className={credentialLabelClass}>密码<input type="password" value={reviewPassword} onChange={(event) => setReviewPassword(event.target.value)} className={credentialInputClass} /></label>
                <button onClick={reviewSignIn} disabled={busy} className="w-full rounded-2xl bg-[#07C160] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">登录</button>
              </>}
              {mode === "choice" && <div className="space-y-3"><button onClick={() => { setMode("create"); setConsented(false); setMessage(""); }} disabled={busy} className="w-full rounded-2xl bg-[#91C968] px-4 py-3 text-sm font-bold text-[#172112]">创建新账号</button><button onClick={() => { setMode("link"); setMessage(""); }} disabled={busy} className="w-full rounded-2xl border border-white/20 px-4 py-3 text-sm font-bold text-white">关联已有邮箱账号</button></div>}
              {mode === "create" && <>
                <label className="block text-xs font-bold text-white/65">昵称（可选）<input value={nickname} maxLength={20} onChange={(event) => setNickname(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/15 bg-[#242a24] px-3 py-3 text-sm text-white" /></label>
                <ConsentRow checked={consented} onChange={setConsented} onTerms={() => openLegal("terms")} onPrivacy={() => openLegal("privacy")} />
                <button onClick={() => void createAccount()} disabled={busy || !consented} className="w-full rounded-2xl bg-[#07C160] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "创建中…" : "同意并创建账号"}</button>
              </>}
              {mode === "link" && <>
                <label className="block text-xs font-bold text-white/65">已有账号的邮箱<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setCodeSent(false); }} className="mt-2 w-full rounded-2xl border border-white/15 bg-[#242a24] px-3 py-3 text-sm text-white" placeholder="name@example.com" /></label>
                <div className="grid grid-cols-[1fr_auto] gap-2"><input inputMode="numeric" value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="min-w-0 rounded-2xl border border-white/15 bg-[#242a24] px-3 py-3 text-sm text-white" placeholder="6 位邮箱验证码" /><button onClick={() => void sendCode()} disabled={busy || !email.includes("@")} className="rounded-2xl border border-[#91C968]/35 px-3 text-xs font-bold text-[#B7E38D] disabled:opacity-50">{codeSent ? "重新发送" : "发送验证码"}</button></div>
                <ConsentRow checked={consented} onChange={setConsented} onTerms={() => openLegal("terms")} onPrivacy={() => openLegal("privacy")} />
                <button onClick={() => void linkAccount()} disabled={busy || !codeSent || emailCode.length !== 6 || !consented} className="w-full rounded-2xl bg-[#07C160] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "关联中…" : "验证并关联微信"}</button>
              </>}
              {message && <p role="status" className="rounded-2xl border border-[#91C968]/20 bg-[#91C968]/10 p-3 text-xs leading-5 text-white/75">{busy && <Loader2 size={14} className="mr-2 inline animate-spin" />}{message}</p>}
              {(mode === "choice" || mode === "create" || mode === "link") && <button onClick={() => { setMode(mode === "create" || mode === "link" ? "choice" : "login"); setMessage(""); }} className="w-full py-2 text-xs font-bold text-white/55">返回</button>}
              {mode === "login" && <div className="flex justify-center gap-4 text-xs font-bold text-white/55"><button onClick={() => openLegal("terms")}>用户协议</button><button onClick={() => openLegal("privacy")}>隐私政策</button></div>}
            </div>
          )}
        </ScrollArea>
      </section>
    </div>
  );
}

function ConsentRow({ checked, onChange, onTerms, onPrivacy }: { checked: boolean; onChange: (value: boolean) => void; onTerms: () => void; onPrivacy: () => void }) {
  return <label className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-white/65"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" /><span><Check size={13} className="sr-only" />我已阅读并同意 <button type="button" onClick={(event) => { event.preventDefault(); onTerms(); }} className="font-bold text-[#B7E38D]">《用户协议》</button> 和 <button type="button" onClick={(event) => { event.preventDefault(); onPrivacy(); }} className="font-bold text-[#B7E38D]">《隐私政策》</button></span></label>;
}
