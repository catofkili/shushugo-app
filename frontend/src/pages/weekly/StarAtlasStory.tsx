import { useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { Sticker } from "../../components/CapybaraMascot";
import type { WeeklyReport } from "../../lib/analytics/weekly";
import { Count, number, weekday } from "../WeeklyReportStory";
import { StarCanvas } from "./StarCanvas";
import { KEYWORD_NOTES, dottedRange, shortDate } from "./variants";
import "./star-atlas.css";

/**
 * 周报 · 星图版。一周七天是北斗七星，学过的日子亮起来；新词是新星，最忙的一天是流星，
 * 没记住的词是暗星，点一下亮。网易云年度报告那套叙事：每页一句话 + 一个大数，逐行浮现。
 * 水豚只出现在最后一页 —— 睡在星空下说晚安，是这个故事里它该在的地方（V3 里是每章左下角硬贴一张）。
 */
const d = (seconds: number, extra: Record<string, string | number> = {}) => ({ "--d": `${seconds}s`, ...extra }) as CSSProperties;

/** 北斗七星：斗口四颗 + 斗柄三颗，按 周日 → 周六 的顺序排。 */
const DIPPER = [[28, 44], [40, 104], [104, 116], [116, 60], [172, 52], [220, 58], [290, 100]] as const;
const DIPPER_LINKS = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] as const;

function Dipper({ daily }: { daily: WeeklyReport["metrics"]["daily"] }) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  // 「亮」和封面那句「点亮了 N 颗星」（metrics.days）同一口径：有作答或有计时都算。
  // 只看作答数会出现「点亮了 1 颗」而七颗全暗 —— 那一天可能只有计时、作答落在边界另一侧。
  const lit = (i: number) => (daily[i]?.reviews ?? 0) > 0 || (daily[i]?.seconds ?? 0) > 0;
  return (
    <svg className="sa-dipper" viewBox="0 0 320 150" role="img" aria-label={daily.map((day, i) => `周${weekday(day.date)}${lit(i) ? (day.reviews ? ` ${day.reviews} 次作答` : " 学过") : " 没学"}`).join("，")}>
      <defs>
        <radialGradient id="sa-glow"><stop offset="0" stopColor="#fff3cf" /><stop offset=".35" stopColor="#ffd88a" stopOpacity=".55" /><stop offset="1" stopColor="#ffd88a" stopOpacity="0" /></radialGradient>
      </defs>
      {DIPPER_LINKS.map(([a, b], i) => (
        <line key={i} x1={DIPPER[a][0]} y1={DIPPER[a][1]} x2={DIPPER[b][0]} y2={DIPPER[b][1]} pathLength={1}
          className={`sa-dipper-link${lit(a) && lit(b) ? " is-lit" : ""}`} style={d(1.9 + i * 0.12)} />
      ))}
      {DIPPER.map(([x, y], i) => {
        const reviews = daily[i]?.reviews ?? 0;
        const on = lit(i);
        const r = on ? 3.5 + 4.5 * Math.sqrt(reviews / peak) : 1.8;
        return (
          <g key={i} className={`sa-dipper-star${on ? " is-lit" : ""}`} style={d(1.1 + i * 0.12, { transformOrigin: `${x}px ${y}px` })}>
            {on && <circle cx={x} cy={y} r={r * 4} fill="url(#sa-glow)" />}
            <circle cx={x} cy={y} r={r} />
            <text x={x} y={y + (i === 0 || i === 3 || i === 4 || i === 5 ? -14 : 22)} textAnchor="middle">{weekday(daily[i]?.date ?? "")}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Rays({ daily }: { daily: WeeklyReport["metrics"]["daily"] }) {
  const peak = Math.max(1, ...daily.map((day) => day.reviews));
  return (
    <svg className="sa-rays" viewBox="0 0 320 320" aria-hidden="true">
      <circle cx="160" cy="160" r="150" className="sa-rays-orbit" />
      <circle cx="160" cy="160" r="112" className="sa-rays-orbit is-inner" />
      {daily.map((day, i) => {
        const angle = (-90 + (i * 360) / daily.length) * (Math.PI / 180);
        // 最长 84：58 + 84 + 标签 14 ≈ 156，收在 viewBox 的 160 半径里；再长会伸出画框压到标题。
        const len = day.reviews ? 22 + 62 * (day.reviews / peak) : 14;
        const x1 = 160 + Math.cos(angle) * 58; const y1 = 160 + Math.sin(angle) * 58;
        const x2 = 160 + Math.cos(angle) * (58 + len); const y2 = 160 + Math.sin(angle) * (58 + len);
        const lx = 160 + Math.cos(angle) * (72 + len); const ly = 160 + Math.sin(angle) * (72 + len) + 4;
        return (
          <g key={day.date} style={d(0.6 + i * 0.1)} className={`sa-ray${day.reviews === peak && day.reviews > 0 ? " is-peak" : ""}${day.reviews ? "" : " is-empty"}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} />
            <text x={lx} y={ly} textAnchor="middle">{weekday(day.date)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function WordStars({ words, onReviewWords }: { words: WeeklyReport["revisitWords"]; onReviewWords?: (ids: number[]) => void }) {
  const [picked, pick] = useState<number | null>(null);
  const most = Math.max(1, ...words.map((word) => word.count));
  const chosen = words.find((word) => word.wordId === picked);
  return <>
    <div className="sa-wordfield" role="group" aria-label="这一周还没记牢的词">
      {words.map((word, i) => (
        <button key={word.wordId} type="button" data-word-art="true"
          className={`sa-wordstar${picked === word.wordId ? " is-lit" : ""}`}
          style={d(0.5 + i * 0.07, { "--dim": (0.35 + 0.5 * (1 - word.count / most)).toFixed(2), "--lift": `${[0, 18, -6, 26, 8, -10, 20, 2][i % 8]}px` })}
          aria-pressed={picked === word.wordId}
          aria-label={`${word.text}，本周 ${word.count} 次模糊或忘记`}
          onClick={() => pick(picked === word.wordId ? null : word.wordId)}>
          <i aria-hidden="true" />
          <b lang="ja">{word.text}</b>
        </button>
      ))}
    </div>
    <p className="sa-caption" aria-live="polite">
      {chosen
        ? <><span><b lang="ja">{chosen.text}</b> · 这周 {chosen.count} 次模糊或忘记</span>{onReviewWords && <button className="sa-link" onClick={() => onReviewWords([chosen.wordId])}>现在练它 <ArrowUpRight size={14} /></button>}</>
        : "点一颗星，把它点亮。"}
    </p>
    {onReviewWords && <button className="sa-cta" style={d(1.2)} onClick={() => onReviewWords(words.map((word) => word.wordId))}>去把它们都点亮 <ArrowUpRight size={16} /></button>}
  </>;
}

export function StarAtlasStory({ report, chapter, onBack, onReviewWords, onShare, animate = true }: {
  report: WeeklyReport; chapter: string; onBack: () => void;
  onReviewWords?: (ids: number[]) => void; onShare: () => void; animate?: boolean;
}) {
  const { metrics, highlight, keyword } = report;
  const count = (value: number) => <Count value={value} animate={animate} />;
  const seed = `${report.window.start}:${chapter}`;
  const peakDay = metrics.daily.reduce((best, day) => (day.reviews > best.reviews ? day : best), metrics.daily[0]);
  const bestDay = highlight ? metrics.daily.find((day) => day.date === highlight.date) : null;
  const modes = [
    { label: "单词", value: metrics.wordReviews },
    { label: "语法", value: metrics.grammarReviews },
    { label: "汉字读音", value: metrics.kanjiReviews }
  ];
  const modePeak = Math.max(1, ...modes.map((mode) => mode.value));

  return (
    <article className={`sa-story sa-${chapter}`}>
      <div className="sa-nebula" aria-hidden="true" />
      <StarCanvas seed={seed} animate={animate} burst={chapter === "content" ? metrics.newWords : 0} comet={chapter === "highlight"} />

      {chapter === "cover" && <div className="sa-body">
        <p className="sa-kicker" style={d(0.3)}>收集日 · 本周星图</p>
        <p className="sa-range" style={d(0.45)}>{dottedRange(report.window)}</p>
        <h1 className="sa-title">
          <span style={d(0.7)}>这一周</span>
          <span style={d(0.95)}>你点亮了 <b className="sa-num">{count(metrics.days)}</b> 颗星</span>
        </h1>
        <Dipper daily={metrics.daily} />
        <p className="sa-line" style={d(2.6)}>每一个学过的日子，都是一颗星。{metrics.days >= 7 ? "这周的北斗，一颗都没缺。" : ""}</p>
      </div>}

      {chapter === "effort" && <div className="sa-body">
        <p className="sa-kicker" style={d(0.2)}>时间</p>
        <h2 className="sa-title is-small"><span style={d(0.35)}>这一周，你把</span></h2>
        <div className="sa-orbit-wrap" style={d(0.5)}>
          <Rays daily={metrics.daily} />
          <div className="sa-orb"><b>{metrics.totalSeconds < 60 ? "不足 1" : count(metrics.minutes)}</b><span>分钟</span></div>
        </div>
        <h2 className="sa-title is-small"><span style={d(1.3)}>留给了日语。</span></h2>
        <p className="sa-line" style={d(1.7)}><b>{number(metrics.totalReviews)}</b> 次作答散落在这一周，{peakDay?.reviews ? <>最亮的是<b>周{weekday(peakDay.date)}</b>，{number(peakDay.reviews)} 次。</> : "还没有哪一天亮起来。"}</p>
        <p className="sa-fine" style={d(2)}>周日那一格是首尾两个半天之和。</p>
      </div>}

      {chapter === "content" && <div className="sa-body is-center">
        <p className="sa-kicker" style={d(0.2)}>新星</p>
        <div className="sa-mega" style={d(0.9)}><b>{count(metrics.newWords)}</b><span>颗新星</span></div>
        <p className="sa-line" style={d(1.6)}>{metrics.newWords ? <>这一周，有 <b>{number(metrics.newWords)}</b> 个单词第一次和你相遇。</> : "这一周没有新词，你在和老朋友叙旧。"}</p>
        <div className="sa-planets">
          {modes.map((mode, i) => (
            <div key={mode.label} className="sa-planet" style={d(2 + i * 0.15, { "--size": `${58 + 42 * Math.sqrt(mode.value / modePeak)}px` })}>
              <i aria-hidden="true" /><b>{number(mode.value)}</b><span>{mode.label}</span>
            </div>
          ))}
        </div>
        <p className="sa-fine" style={d(2.6)}>另外 {number(metrics.reviewCount)} 次，是和旧相识再打一次招呼。</p>
      </div>}

      {chapter === "keyword" && keyword && <div className="sa-body is-center">
        <div className="sa-halo" aria-hidden="true"><i /><i /><i /></div>
        <p className="sa-kicker" style={d(0.2)}>本周的你</p>
        <p className="sa-line" style={d(0.5)}>这一周，你是</p>
        <p className="sa-keyword" style={d(1)}>{keyword.keyword}</p>
        {KEYWORD_NOTES[keyword.keyword] && <p className="sa-line" style={d(1.8)}>{KEYWORD_NOTES[keyword.keyword]}。</p>}
        {report.keywordCandidates.length > 1 && <p className="sa-fine" style={d(2.3)}>也有一点像：{report.keywordCandidates.filter((item) => item.keyword !== keyword.keyword).map((item) => item.keyword).join(" · ")}</p>}
      </div>}

      {chapter === "highlight" && highlight && <div className="sa-body">
        <p className="sa-kicker" style={d(0.2)}>流星</p>
        <h2 className="sa-title is-small"><span style={d(0.4)}>流星划过的那一天</span></h2>
        <p className="sa-date" style={d(0.9)}>{shortDate(highlight.date)}<small>周{weekday(highlight.date)}</small></p>
        <p className="sa-line" style={d(1.5)}>那天你完成了 <b>{number(bestDay?.reviews ?? 0)}</b> 次学习，</p>
        <p className="sa-line" style={d(1.8)}>是这一周最亮的一刻。</p>
      </div>}

      {chapter === "revisit" && <div className="sa-body is-center">
        <p className="sa-kicker" style={d(0.2)}>暗星</p>
        <h2 className="sa-title is-small"><span style={d(0.35)}>还有几颗星，没那么亮</span></h2>
        <p className="sa-fine" style={d(0.5)}>这周和它们打过照面，还没记牢。越暗的，忘得越多。</p>
        <WordStars words={report.revisitWords} onReviewWords={onReviewWords} />
      </div>}

      {chapter === "end" && <div className="sa-body is-center">
        <p className="sa-kicker" style={d(0.2)}>晚安</p>
        <p className="sa-line" style={d(0.4)}>到今天为止，你走过 <b>{number(metrics.cumulativeDays)}</b> 个学习日{metrics.streak >= 3 ? <>，已经连续 <b>{number(metrics.streak)}</b> 天</> : null}，</p>
        <div className="sa-mega" style={d(0.8)}><b>{count(metrics.cumulativeWords)}</b><span>个词</span></div>
        <p className="sa-line" style={d(1.4)}>是你自己一颗一颗攒出来的银河。</p>
        <div className="sa-sleep" style={d(1.8)} aria-hidden="true">
          <span className="sa-moon" />
          <Sticker name="mood-sleep" size={112} />
          <span className="sa-bubble">晚安，下周见</span>
        </div>
        <div className="sa-actions" style={d(2.2)}>
          <button className="sa-cta" onClick={onShare}>收好这片星空 <ArrowUpRight size={16} /></button>
          <button className="sa-link" onClick={onBack}>回到日常</button>
        </div>
      </div>}
    </article>
  );
}
