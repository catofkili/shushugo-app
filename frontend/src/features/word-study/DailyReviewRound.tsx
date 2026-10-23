import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "../../components/ScrollArea";
import { MascotSay } from "../../components/MascotSay";
import { Sticker } from "../../components/CapybaraMascot";
import { getStudyPreferences, jsMotionAllowed } from "../../lib/studyPreferences";
import type { WordCard } from "../../types/vocabulary";
import type { DailyReviewRound } from "../../lib/word-api/daily-review-round";
import "./DailyReviewRound.css";

const reviewMotionClass = () => getStudyPreferences().motionLevel === "off"
  ? "daily-review-motion-off" : jsMotionAllowed() ? "" : "daily-review-motion-reduced";

const statusLabels = { pending: "待答", once: "待复查", done: "已拿下" };
const ProgressDots = ({ round }: { round: DailyReviewRound }) => (
  <div className="daily-review-dots" role="list" aria-label="本轮进度">
    {round.words.map(({ id, status }, index) => (
      <span key={`${id}:${status}`} role="listitem" aria-label={`第 ${index + 1} 个词：${statusLabels[status]}`}
        className={`daily-review-dot daily-review-dot-${status}`} />
    ))}
  </div>
);

// 先淡出再换卡，避免卸载时动画还没来得及播放；离开页面时取消回调。
const useCardExit = () => {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const exit = (action: () => void) => {
    if (timer.current !== null) return;
    setLeaving(true);
    timer.current = setTimeout(action, 160);
  };
  return { leaving, exit };
};

const useCardKeys = (accept: () => void, decline?: () => void) => {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "Enter" && !(event.key === "Escape" && decline)) return;
      event.preventDefault();
      if (event.key === "Enter") accept();
      else decline?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [accept, decline]);
};

export function DailyReviewInvite({ words, onStart, onDecline }: {
  words: WordCard[]; onStart: () => void; onDecline: () => void;
}) {
  const { leaving, exit } = useCardExit();
  const start = () => exit(onStart);
  const decline = () => exit(onDecline);
  useCardKeys(start, decline);
  return (
    <ScrollArea className={`daily-review-scroll flex-1 ${reviewMotionClass()}`} centerContent>
      <div className={`daily-review-panel${leaving ? " daily-review-panel-leaving" : ""}`} role="region" aria-label="集中拿下邀请">
        <Sticker name="mood-puzzled" size={72} className="daily-review-sticker" />
        <h2 className="daily-review-title">今天有 {words.length} 个词反复卡住</h2>
        <div className="daily-review-chips">
          {words.slice(0, 8).map((word) => <span key={word.id} className="daily-review-chip jp">{word.kanji || word.kana}</span>)}
        </div>
        <div className="daily-review-actions">
          <button type="button" className="ds-btn" disabled={leaving} onClick={start}>集中拿下</button>
          <button type="button" className="ds-btn-soft" disabled={leaving} onClick={decline}>先不</button>
        </div>
      </div>
    </ScrollArea>
  );
}

export function DailyReviewTopBar({ round, onExit }: { round: DailyReviewRound; onExit: () => void }) {
  const done = round.words.filter((word) => word.status === "done").length;
  return (
    <div className={`daily-review-topbar ${reviewMotionClass()}`}>
      <div className="daily-review-heading"><strong>集中拿下</strong><span aria-live="polite">{done}/{round.words.length}</span></div>
      <ProgressDots round={round} />
      <button type="button" className="daily-review-exit" onClick={onExit}>先到这</button>
    </div>
  );
}

export function DailyReviewComplete({ round, onContinue }: { round: DailyReviewRound; onContinue: () => void }) {
  const { leaving, exit } = useCardExit();
  const resume = () => exit(onContinue);
  useCardKeys(resume);
  return (
    <ScrollArea className={`daily-review-scroll flex-1 ${reviewMotionClass()}`} centerContent>
      <div className={`daily-review-panel${leaving ? " daily-review-panel-leaving" : ""}`} role="region" aria-label="集中拿下完成">
        <MascotSay sticker="mood-cheer" tone="good" size={68}><strong>{round.words.length} 个都拿下了</strong></MascotSay>
        <ProgressDots round={round} />
        <div className="daily-review-actions"><button type="button" className="ds-btn" disabled={leaving} onClick={resume}>继续</button></div>
      </div>
    </ScrollArea>
  );
}
