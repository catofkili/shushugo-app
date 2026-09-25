import React from "react";
import { createRoot } from "react-dom/client";
import { Pause } from "lucide-react";
import { TimerRing } from "./src/components/TimerRing";
import { KanjiPairLines } from "./src/features/mixed-study/KanjiPairLines";
import "./src/styles.css";
import "./src/app.css";
import "./src/design.css";
import "./src/skins.css";

const timer = { remaining: 18, total: 30, paused: false };
const items = [
  { targetReading: "ひ" },
  { targetReading: "つき" },
  { targetReading: "みず" }
] as any;
const readings = ["つき", "みず", "ひ"];
const pairs = { 0: 1, 1: 0, 2: 2 };

const TimerBefore = ({ remaining, total, paused }: typeof timer) => {
  const circumference = 97.4;
  const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return <span className={`vt-timer ${remaining <= 5 && !paused ? "is-low" : ""}`} role="timer" aria-label={paused ? "已暂停" : `剩 ${remaining} 秒`}>
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" className="vt-timer-track" />
      <circle cx="18" cy="18" r="15.5" className="vt-timer-fill" style={{ strokeDasharray: `${ratio * circumference} ${circumference}` }} />
    </svg>
    <b>{paused ? <Pause size={13} /> : remaining}</b>
  </span>;
};

const PairBefore = ({ revealed = false }: { revealed?: boolean }) => <svg
  aria-hidden="true" className="pointer-events-none absolute left-[calc(50%-30px)] top-0 z-0 h-full w-[60px] overflow-visible"
  viewBox="0 0 100 100" preserveAspectRatio="none"
>
  {items.map((item: { targetReading: string }, wordIndex: number) => {
    const centerY = ((wordIndex + 0.5) / items.length) * 100;
    const assignedReading = pairs[wordIndex as keyof typeof pairs];
    const correctReading = readings.indexOf(item.targetReading);
    if (!revealed) return assignedReading === undefined ? null : <line key={`attempt-${wordIndex}`} x1="0" y1={centerY} x2="100" y2={((assignedReading + 0.5) / items.length) * 100} stroke="#d7b5f1" strokeWidth="2.6" strokeLinecap="round" opacity="0.8" />;
    return <g key={`answer-${wordIndex}`}>
      {assignedReading !== undefined && assignedReading !== correctReading && <line x1="0" y1={centerY} x2="100" y2={((assignedReading + 0.5) / items.length) * 100} stroke="#f19595" strokeWidth="2.4" strokeLinecap="round" opacity="0.78" />}
      <line x1="0" y1={centerY} x2="100" y2={((correctReading + 0.5) / items.length) * 100} stroke="#81D8CF" strokeWidth="2.8" strokeLinecap="round" opacity="0.92" />
    </g>;
  })}
</svg>;

const PairAfter = () => <KanjiPairLines items={items} pairs={pairs} readings={readings} revealed={false} />;

const Panel = ({ label, children }: React.PropsWithChildren<{ label: string }>) => <section className="compare-panel">
  <h2>{label}</h2>{children}
</section>;

const PairCard = ({ old }: { old: boolean }) => <div className="pair-demo">
  <div className="match-rows"><b>日</b><b>月</b><b>水</b></div>
  <div className="line-area">{old ? <PairBefore /> : <PairAfter />}</div>
  <div className="match-rows"><span>つき</span><span>みず</span><span>ひ</span></div>
</div>;

createRoot(document.getElementById("root")!).render(<main className="compare-root">
  <h1>抽取前后网页组件对照</h1>
  <div className="compare-grid">
    <Panel label="改动前 · 倒计时圈"><TimerBefore {...timer} /></Panel>
    <Panel label="改动后 · 倒计时圈"><TimerRing {...timer} /></Panel>
    <Panel label="改动前 · 连线题"><PairCard old /></Panel>
    <Panel label="改动后 · 连线题"><PairCard old={false} /></Panel>
  </div>
</main>);

const style = document.createElement("style");
style.textContent = `
  html,body,#root{margin:0;min-height:100%;width:100%;background:#f8f4eb;color:#343838;font-family:system-ui,sans-serif}
  .compare-root{box-sizing:border-box;padding:12px;width:375px}
  .compare-root h1{font-size:16px;margin:0 0 8px}
  .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .compare-panel{background:#fff;border:1px solid #e8e1d5;border-radius:12px;padding:8px;min-width:0}
  .compare-panel h2{font-size:11px;margin:0 0 8px}
  .compare-panel .vt-timer{margin:auto}
  .pair-demo{display:grid;grid-template-columns:1fr 60px 1fr;align-items:start;min-height:204px}
  .line-area{height:204px;position:relative;width:60px}
  .match-rows{display:grid;grid-template-rows:repeat(3,68px);font-size:12px;text-align:center;align-items:center}
`;
document.head.appendChild(style);
