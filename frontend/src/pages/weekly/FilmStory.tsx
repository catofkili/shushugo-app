import { useEffect, useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { Sticker } from "../../components/CapybaraMascot";
import type { WeeklyReport } from "../../lib/analytics/weekly";
import { useCountUp } from "../../hooks/useCountUp";
import { jsMotionAllowed } from "../../lib/studyPreferences";
import { Count, number, weekday } from "../WeeklyReportStory";
import { KEYWORD_NOTES, dottedRange, shortDate } from "./variants";
import "./film.css";

/**
 * 周报 · 放映厅版。这一周是一部片子：片头倒计时 → 片长（时间码）→ 新面孔登场 → 角色海报（关键词）
 * → 高光镜头 → 还要再拍一条（没记住的词，场记板）→ 片尾字幕。
 * 水豚在片尾字幕里当「场记」—— 给它一个在故事里的身份，而不是每章左下角贴一张（V3 的做法）。
 */
const d = (seconds: number, extra: Record<string, string | number> = {}) => ({ "--d": `${seconds}s`, ...extra }) as CSSProperties;

/** 片头倒计时每周每次打开只放一遍：翻回封面再放一次 3-2-1 只会让人烦。 */
const leaderPlayed = new Set<string>();

const timecode = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((part) => String(part).padStart(2, "0")).join(":");
};

function Timecode({ seconds, animate }: { seconds: number; animate: boolean }) {
  const shown = useCountUp(animate ? seconds : 0);
  return <><span aria-hidden="true">{timecode(animate ? shown : seconds)}</span><span className="wr-sr-only">{Math.round(seconds / 60)} 分钟</span></>;
}

function Clapboards({ words, onReviewWords }: { words: WeeklyReport["revisitWords"]; onReviewWords?: (ids: number[]) => void }) {
  const [picked, pick] = useState<number | null>(null);
  return <>
    <div className="fm-claps" role="group" aria-label="这一周还没记牢的词">
      {words.map((word, i) => {
        const on = picked === word.wordId;
        return (
          <div key={word.wordId} className={`fm-clap${on ? " is-on" : ""}`} style={d(0.4 + i * 0.08, { "--tilt": `${[-3, 2, -1, 3, -2, 1][i % 6]}deg` })}>
            <button type="button" data-word-art="true" className="fm-clap-hit" aria-pressed={on}
              aria-label={`${word.text}，本周 ${word.count} 次模糊或忘记，点击${on ? "收起" : "打板"}`}
              onClick={() => pick(on ? null : word.wordId)}>
              <span className="fm-clap-stick" aria-hidden="true" />
              <span className="fm-clap-board">
                <small>第 {String(i + 1).padStart(2, "0")} 场</small>
                <b lang="ja">{word.text}</b>
                <em>NG × {word.count}</em>
              </span>
            </button>
            {on && onReviewWords && <button className="fm-link fm-clap-again" onClick={() => onReviewWords([word.wordId])}>再拍这条 <ArrowUpRight size={13} /></button>}
          </div>
        );
      })}
    </div>
    {onReviewWords && <button className="fm-cta" style={d(1)} onClick={() => onReviewWords(words.map((word) => word.wordId))}>全部重拍一遍 <ArrowUpRight size={16} /></button>}
  </>;
}

export function FilmStory({ report, chapter, onBack, onReviewWords, onShare, animate = true }: {
  report: WeeklyReport; chapter: string; onBack: () => void;
  onReviewWords?: (ids: number[]) => void; onShare: () => void; animate?: boolean;
}) {
  const { metrics, highlight, keyword } = report;
  const count = (value: number) => <Count value={value} animate={animate} />;
  const [intro] = useState(() => chapter === "cover" && animate && jsMotionAllowed() && !leaderPlayed.has(report.window.start));
  useEffect(() => { if (intro) leaderPlayed.add(report.window.start); }, [intro, report.window.start]);
  const peak = Math.max(1, ...metrics.daily.map((day) => day.reviews));
  const bestDay = highlight ? metrics.daily.find((day) => day.date === highlight.date) : null;
  const tracks = [
    { label: "单词", value: metrics.wordReviews, mark: "あ" },
    { label: "语法", value: metrics.grammarReviews, mark: "文" },
    { label: "汉字读音", value: metrics.kanjiReviews, mark: "字" }
  ];
  const credits: [string, string][] = [
    ["主演", "你"],
    ["片长", metrics.totalSeconds < 60 ? "不足 1 分钟" : `${number(metrics.minutes)} 分钟`],
    ["出场", `${metrics.days} 天`],
    ["镜头", `${number(metrics.totalReviews)} 个`],
    ["新面孔", `${number(metrics.newWords)} 位`],
    ...(keyword ? [["角色", keyword.keyword] as [string, string]] : []),
    ["累计学习日", `${number(metrics.cumulativeDays)} 天`],
    ["累计相识的词", `${number(metrics.cumulativeWords)} 个`]
  ];

  return (
    <article className={`fm-story fm-${chapter}`} style={{ "--intro": intro ? "2.7s" : "0s" } as CSSProperties}>
      <div className="fm-leak" aria-hidden="true" />
      <div className="fm-sprockets" aria-hidden="true"><i /><i /></div>
      <div className="fm-grain" aria-hidden="true" />

      {chapter === "cover" && <>
        {intro && <div className="fm-leader" aria-hidden="true">
          <div className="fm-leader-dial"><i className="fm-leader-sweep" /><span>3</span><span>2</span><span>1</span></div>
        </div>}
        <div className="fm-body is-center fm-titlecard">
          <p className="fm-kicker" style={d(0.2)}>收集日 出品</p>
          <h1 className="fm-title" style={d(0.5)}><span>《</span>我和日语的<br />这一周<span>》</span></h1>
          <p className="fm-range" style={d(1.1)}>{dottedRange(report.window)}</p>
          <div className="fm-billing" style={d(1.5)}>
            <p><small>主演</small><b>你</b></p>
            <p><small>出场</small><b>{count(metrics.days)}<i> 天</i></b></p>
          </div>
          <p className="fm-fine" style={d(2)}>左滑开场 →</p>
        </div>
      </>}

      {chapter === "effort" && <div className="fm-body">
        <p className="fm-kicker" style={d(0.2)}>第一幕 · 片长</p>
        <h2 className="fm-head" style={d(0.4)}>这一周，你为日语留出了</h2>
        <p className="fm-timecode" style={d(0.8)}><i className="fm-rec" aria-hidden="true" /><Timecode seconds={metrics.totalSeconds} animate={animate} /></p>
        <div className="fm-strip" role="img" aria-label={metrics.daily.map((day) => `周${weekday(day.date)} ${day.reviews} 次`).join("，")}>
          {metrics.daily.map((day, i) => (
            <div key={day.date} className={`fm-frame${day.reviews === peak && day.reviews > 0 ? " is-peak" : ""}`} style={d(1.2 + i * 0.1)} aria-hidden="true">
              <span className="fm-frame-fill" style={{ transform: `scaleY(${day.reviews / peak})` }} />
              <b>{number(day.reviews)}</b>
              <small>{weekday(day.date)}</small>
            </div>
          ))}
        </div>
        <p className="fm-line" style={d(2.1)}>一共拍下 <b>{number(metrics.totalReviews)}</b> 个镜头。</p>
        <p className="fm-fine" style={d(2.3)}>每一格是一天的作答；周日那格是首尾两个半天之和。</p>
      </div>}

      {chapter === "content" && <div className="fm-body is-center">
        <div className="fm-spot" aria-hidden="true" />
        <p className="fm-kicker" style={d(0.2)}>第二幕 · 新面孔</p>
        <p className="fm-mega" style={d(0.7)}><b>{count(metrics.newWords)}</b><span>位新角色登场</span></p>
        <p className="fm-line" style={d(1.3)}>{metrics.newWords ? <>这一周，有 <b>{number(metrics.newWords)}</b> 个单词第一次出现在你的故事里。</> : "这一周没有新角色，老演员们演得更熟了。"}</p>
        <div className="fm-tickets">
          {tracks.map((track, i) => (
            <div key={track.label} className="fm-ticket" style={d(1.8 + i * 0.15)}>
              <span className="fm-ticket-mark" aria-hidden="true">{track.mark}</span>
              <span><small>{track.label}线</small><b>{number(track.value)}</b></span>
            </div>
          ))}
        </div>
        <p className="fm-fine" style={d(2.5)}>其中 {number(metrics.reviewCount)} 条是重拍（复习）。</p>
      </div>}

      {chapter === "keyword" && keyword && <div className="fm-body is-center">
        <p className="fm-kicker" style={d(0.2)}>角色设定</p>
        <div className="fm-poster" style={d(0.5)}>
          <span className="fm-poster-tag">本周主演 你 饰</span>
          <b className="fm-poster-title">{keyword.keyword}</b>
          {KEYWORD_NOTES[keyword.keyword] && <span className="fm-poster-line">「{KEYWORD_NOTES[keyword.keyword]}」</span>}
          <span className="fm-poster-foot">{dottedRange(report.window)} · 收集日</span>
        </div>
        {report.keywordCandidates.length > 1 && <p className="fm-fine" style={d(1.6)}>客串：{report.keywordCandidates.filter((item) => item.keyword !== keyword.keyword).map((item) => item.keyword).join(" · ")}</p>}
      </div>}

      {chapter === "highlight" && highlight && <div className="fm-body is-center">
        <div className="fm-flash" aria-hidden="true" />
        <p className="fm-kicker" style={d(0.2)}>第三幕 · 高光镜头</p>
        <div className="fm-viewfinder" style={d(0.35)}>
          <i className="fm-corner" /><i className="fm-corner" /><i className="fm-corner" /><i className="fm-corner" />
          <span className="fm-vf-rec" aria-hidden="true">● 定格</span>
          <p className="fm-vf-date">{shortDate(highlight.date)}<small>周{weekday(highlight.date)}</small></p>
          <p className="fm-vf-count"><b>{number(bestDay?.reviews ?? 0)}</b> 次作答</p>
        </div>
        <p className="fm-line" style={d(1.4)}>这是这一周，戏最多的一天。</p>
      </div>}

      {chapter === "revisit" && <div className="fm-body is-center">
        <p className="fm-kicker" style={d(0.2)}>花絮 · 还要再拍一条</p>
        <h2 className="fm-head" style={d(0.3)}>这几条，还没过</h2>
        <p className="fm-fine" style={d(0.4)}>点一下场记板打板；NG 次数是这周模糊或忘记的次数。</p>
        <Clapboards words={report.revisitWords} onReviewWords={onReviewWords} />
      </div>}

      {chapter === "end" && <div className="fm-body is-center">
        <p className="fm-kicker" style={d(0.1)}>片尾</p>
        <div className="fm-credits">
          <div className="fm-roll">
            {credits.map(([role, name]) => <p key={role}><small>{role}</small><b>{name}</b></p>)}
            <p className="fm-credit-crew"><small>场记</small><b><Sticker name="scene-book" size={56} />水豚</b></p>
            <p><small>出品</small><b>收集日</b></p>
          </div>
        </div>
        <span className="fm-fin" aria-label="完">完</span>
        <p className="fm-line" style={d(5.4)}>下周同一时间，继续放映。</p>
        <div className="fm-actions" style={d(5.8)}>
          <button className="fm-cta" onClick={onShare}>收好这张片子 <ArrowUpRight size={16} /></button>
          <button className="fm-link" onClick={onBack}>散场，回到日常</button>
        </div>
      </div>}
    </article>
  );
}
