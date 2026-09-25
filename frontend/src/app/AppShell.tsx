import { useEffect, useState, type ReactNode } from "react";
import { AuthDialog } from "../components/AuthDialog";
import { CapybaraMascot } from "../components/CapybaraMascot";
import { LevelSetup } from "../components/LevelSetup";
import { Paywall } from "../components/Paywall";
import { getPersistenceFailure, PERSISTENCE_ERROR_EVENT, PERSISTENCE_OK_EVENT, saveDatabase } from "../lib/storage";
import { LEVEL_PLAN_TRIAL_EXPIRES_KEY, LEVEL_PLAN_TRIAL_NOTICE_KEY, type CloudSession } from "../lib/sync-api";
import { useApp, AppContextProvider, type AppContextValue } from "./AppContext";
import type { FeatureId } from "../lib/entitlements";

interface AchievementPop {
  item: { emoji: string; name: string };
  rest: number;
  leaving: boolean;
}

interface AppShellProps {
  context: AppContextValue;
  className: string;
  children: ReactNode;
  achievementPop: AchievementPop | null;
  notice: string;
  paywallTarget?: FeatureId | "general";
  authOpen: boolean;
  levelSetupOpen: boolean;
  trialEndedOpen: boolean;
  onAuthenticated(session: CloudSession): Promise<void>;
  onClosePaywall(): void;
  onCloseAuth(): void;
  onLevelSetupComplete(message: string): void;
  onDismissTrial(): void;
  onViewPro(): void;
}

export function AppShell({
  context,
  className,
  children,
  achievementPop,
  notice,
  paywallTarget,
  authOpen,
  levelSetupOpen,
  trialEndedOpen,
  onAuthenticated,
  onClosePaywall,
  onCloseAuth,
  onLevelSetupComplete,
  onDismissTrial,
  onViewPro
}: AppShellProps) {
  return (
    <AppContextProvider value={context}>
      <div className={className}>
        {children}
        <GlobalOverlays
          achievementPop={achievementPop}
          notice={notice}
          paywallTarget={paywallTarget}
          authOpen={authOpen}
          levelSetupOpen={levelSetupOpen}
          trialEndedOpen={trialEndedOpen}
          onAuthenticated={onAuthenticated}
          onClosePaywall={onClosePaywall}
          onCloseAuth={onCloseAuth}
          onLevelSetupComplete={onLevelSetupComplete}
          onDismissTrial={onDismissTrial}
          onViewPro={onViewPro}
        />
      </div>
    </AppContextProvider>
  );
}

function GlobalOverlays({
  achievementPop,
  notice,
  paywallTarget,
  authOpen,
  levelSetupOpen,
  trialEndedOpen,
  onAuthenticated,
  onClosePaywall,
  onCloseAuth,
  onLevelSetupComplete,
  onDismissTrial,
  onViewPro
}: Omit<AppShellProps, "context" | "children" | "className">) {
  const { navigate } = useApp();

  return (
    <>
      {achievementPop && (
        <div
          className={`zoo-achv-pop${achievementPop.leaving ? " leaving" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="zoo-achv-emoji" aria-hidden="true">{achievementPop.item.emoji}</span>
          <span className="zoo-achv-copy">
            <span className="zoo-achv-kick">成就解锁</span>
            <span className="zoo-achv-name">{achievementPop.item.name}</span>
          </span>
          {achievementPop.rest > 0 && <span className="zoo-achv-rest">还有 {achievementPop.rest} 个</span>}
        </div>
      )}
      {notice && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#81D8CF] px-4 py-3 text-sm font-semibold text-[#1f3a36] shadow-lg lg:bottom-5">
          {notice}
        </div>
      )}
      <PersistenceBanner />
      {paywallTarget && (
        <Paywall
          feature={paywallTarget === "general" ? undefined : paywallTarget}
          onClose={onClosePaywall}
          onUnlocked={onClosePaywall}
          onOpenPrivacy={() => {
            onClosePaywall();
            navigate("privacy-policy");
          }}
        />
      )}
      <AuthDialog open={authOpen} onClose={onCloseAuth} onAuthenticated={onAuthenticated} />
      {levelSetupOpen && (
        <LevelSetup open onComplete={onLevelSetupComplete} />
      )}
      {/* 原来是写死的奶油底 + jp-ink：深色主题下浅底浅字；z-85 也压不过手机底栏（9999） */}
      {trialEndedOpen && <TrialEndedDialog onDismiss={onDismissTrial} onViewPro={onViewPro} />}
    </>
  );
}

function TrialEndedDialog({ onDismiss, onViewPro }: { onDismiss(): void; onViewPro(): void }) {
  return (
    <div className="fixed inset-0 z-[10001] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="试用结束">
      <div className="ds-card w-full max-w-sm p-5">
        <div className="flex items-center gap-3">
          <CapybaraMascot mood="shy" size={64} className="shrink-0" />
          <h2 className="text-xl font-black">7 天试用结束啦</h2>
        </div>
        <p className="mt-3 text-sm leading-6" style={{ color: "var(--ds-ink-2)" }}>计划会继续安排单词。开通 Pro 后，语法、汉字和辨析会按原来的计划恢复。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="ds-btn-soft focus-ring" onClick={onDismiss}>知道了</button>
          <button className="ds-btn focus-ring" onClick={onViewPro}>看看 Pro</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「刚才那次没存下去」的常驻提示。
 *
 * ⚠️ 以前 PERSISTENCE_ERROR_EVENT 只有 GrammarHighlightProvider 在听,而那个
 * Provider 只包着语法页 —— 在单词学习页写盘失败时,除了控制台一行 error 之外
 * 什么都不会发生,用户会接着答几十张卡,以为都记下了。所以它挂在常驻层。
 *
 * 不做「正在保存」那一档:正常节奏下每 2 秒就有一次写入,一个每两秒闪一下的
 * 指示器只是噪音。要说的只有「没存下去」和「又好了」。
 */
function PersistenceBanner() {
  const [failed, setFailed] = useState(getPersistenceFailure);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onError = () => setFailed(getPersistenceFailure());
    window.addEventListener(PERSISTENCE_ERROR_EVENT, onError);
    window.addEventListener(PERSISTENCE_OK_EVENT, onError);
    onError();
    return () => {
      window.removeEventListener(PERSISTENCE_ERROR_EVENT, onError);
      window.removeEventListener(PERSISTENCE_OK_EVENT, onError);
    };
  }, []);

  if (!failed) return null;
  const retry = () => {
    setRetrying(true);
    void saveDatabase()
      .then(() => setFailed(getPersistenceFailure()))
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  };
  return (
    <div
      role="alert"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-[60] flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#B3402F] px-4 py-3 text-sm font-semibold text-white shadow-lg lg:bottom-5"
    >
      <CapybaraMascot mood="surprised" size={34} className="shrink-0" />
      <span className="flex-1 leading-5">{failed === "recovery"
        ? "部分学习记录未能恢复，当前显示较早的存档。请保留本机数据并联系支持；重新保存不能找回缺失的记录。"
        : "学习记录没能保存到本机，请检查存储空间。这期间答的题可能丢失。"}</span>
      {failed === "save" && (
        <button onClick={retry} disabled={retrying} className="focus-ring shrink-0 rounded-2xl bg-white/15 px-3 py-1.5 text-xs font-bold disabled:opacity-60">
          {retrying ? "重试中" : "重试"}
        </button>
      )}
    </div>
  );
}

export const markTrialNoticeRead = () => {
  const expiresAt = localStorage.getItem(LEVEL_PLAN_TRIAL_EXPIRES_KEY);
  if (expiresAt) localStorage.setItem(LEVEL_PLAN_TRIAL_NOTICE_KEY, expiresAt);
};
