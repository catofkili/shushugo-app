import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { CLOUD_AUTH_EVENT, CLOUD_SYNC_EVENT } from "../lib/sync-api";
import { claimReferral, fetchReferral, type Referral } from "../lib/referral";
import { referralEarningsText, referralRules } from "../lib/referral-copy";
import { copyText, shareText } from "../lib/share-text";
import { pageShareButtonProps, usePageShare } from "../lib/page-share";
import "./InvitePage.css";

export function InvitePage({ initialCode = "", focusInput = false }: { initialCode?: string; focusInput?: boolean }) {
  const { cloudSession, requireAccount } = useApp();
  const [me, setMe] = useState<Referral | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const share = { title: "一起在收集日学日语", path: `/study/invite/index?ref=${encodeURIComponent(me?.code ?? "")}` };
  usePageShare(me ? share : null);

  useEffect(() => {
    let active = true;
    const reload = () => {
      const version = ++generation.current;
      setMe(null); setLoaded(false); setMessage(""); setBusy(false);
      void fetchReferral().then((result) => {
        if (active && version === generation.current) { setMe(result); setLoaded(true); }
      });
    };
    reload();
    window.addEventListener(CLOUD_AUTH_EVENT, reload);
    window.addEventListener(CLOUD_SYNC_EVENT, reload);
    return () => {
      active = false; generation.current++;
      window.removeEventListener(CLOUD_AUTH_EVENT, reload);
      window.removeEventListener(CLOUD_SYNC_EVENT, reload);
    };
  }, [cloudSession.token, cloudSession.email]);
  useEffect(() => {
    if (focusInput && me?.canClaim && !me.claim) input.current?.focus?.();
  }, [focusInput, me]);

  const claim = async () => {
    const version = generation.current;
    setBusy(true); setMessage("");
    try {
      const bound = await claimReferral(code);
      if (version === generation.current && bound) setMe((value) => value ? { ...value, claim: bound, canClaim: false } : value);
    } catch (error) {
      if (version === generation.current) setMessage(error instanceof Error ? error.message : "暂时没能绑定，请重试");
    } finally { if (version === generation.current) setBusy(false); }
  };
  const copy = async () => {
    if (!me) return;
    try { await copyText(me.code); setMessage("已复制"); } catch { setMessage("未能复制，请重试"); }
  };
  const shareInvite = async () => {
    if (!me) return;
    try {
      const url = new URL(window.location.href);
      url.search = ""; url.hash = ""; url.searchParams.set("ref", me.code);
      await shareText(share.title, `${share.title}：${url.href}`);
    } catch { /* 取消系统分享无需提示。 */ }
  };

  return <div className="invite-page">
    {!cloudSession.token ? <section className="ds-card invite-panel">
      <p>登录后查看邀请码</p><button className="ds-btn" onClick={() => requireAccount("invite")}>去登录</button>
    </section> : !me ? <section className="ds-card invite-panel" aria-live="polite">
      <p>{loaded ? "暂时没能获取邀请码" : "正在加载…"}</p>
      {loaded && <button className="ds-btn-soft" onClick={() => { setLoaded(false); void fetchReferral().then((value) => { setMe(value); setLoaded(true); }); }}>重试</button>}
    </section> : <>
      <section className="zoo-tm-invite-ticket">
        <div className="zoo-tm-ticket-copy"><span>我的邀请码</span><b>{me.code}</b></div>
        <div className="zoo-tm-invite-actions">
          <button className="ds-btn-soft" onClick={() => void copy()}>复制</button>
          <button className="ds-btn" {...pageShareButtonProps(share, () => void shareInvite())}>分享</button>
        </div>
      </section>
      <div className="invite-stats"><span>已邀请 {me.invitedCount} 人</span>{referralEarningsText(me) && <span>{referralEarningsText(me)}</span>}</div>
      {me.claim ? <section className="ds-card invite-panel"><b>已绑定</b></section> : me.canClaim && <section className="ds-card invite-panel">
        <label htmlFor="referral-code">有邀请码？</label>
        <div className="invite-claim-row">
          <input id="referral-code" ref={input} autoFocus={focusInput} value={code} maxLength={32} autoCapitalize="characters" autoComplete="off" aria-label="邀请码" placeholder="输入邀请码" onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter" && code.trim() && !busy) void claim(); }} />
          <button className="ds-btn" disabled={busy || !code.trim()} onClick={() => void claim()}>{busy ? "确认中…" : "确认"}</button>
        </div>
      </section>}
      {referralRules && <p className="invite-rules">{referralRules}</p>}
    </>}
    {message && <p className="invite-message" role="status">{message}</p>}
  </div>;
}
