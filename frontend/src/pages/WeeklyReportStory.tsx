import { useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import type { WeeklyReport } from "../lib/analytics/weekly";
import { useCountUp } from "../hooks/useCountUp";

export const weeklyChapters = (report: WeeklyReport | null) => [
  { id: "cover", label: "这一周" }, { id: "effort", label: "时间的形状" }, { id: "content", label: "字间相遇" },
  ...(report?.highlight ? [{ id: "highlight", label: "记住这一刻" }] : []),
  ...(report?.revisitWords.length ? [{ id: "revisit", label: "再见一面" }] : []),
  { id: "end", label: "留给下周" }
];
const number = (value: number) => value.toLocaleString("zh-CN");
const weekday = (date: string) => ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00`).getDay()] ?? "";
const style = (index: number, extra: Record<string, string | number> = {}) => ({ "--i": index, ...extra } as CSSProperties);

/** 数字动画只在当前场景播放；离场副本直接显示最终数字，避免回到 0。读屏也始终读最终值。 */
function Count({ value, animate }: { value: number; animate: boolean }) {
  const displayed = useCountUp(animate ? value : 0);
  return <><span aria-hidden="true">{number(animate ? displayed : value)}</span><span className="wr-sr-only">{number(value)}</span></>;
}

function Dust() {
  return <div className="wr-dust" aria-hidden="true">{Array.from({length:14}, (_,i) => <i key={i} style={style(i,{left:`${(i*37+9)%100}%`,top:`${(i*19+7)%100}%`})} />)}</div>;
}

/** 词语本身构成纸叶上的字景。纸色、字号与位置是构图，不表示掌握程度。 */
function WordGarden({ words, onReviewWords }: { words: WeeklyReport["revisitWords"]; onReviewWords?: (ids: number[]) => void }) {
  const [picked, pick] = useState<number | null>(null);
  const chosen = words.find(word => word.wordId === picked);
  return <>
    <div className="wr-word-garden" role="group" aria-label="这一周的词语字景">
      {words.map((word,index) => <button type="button" data-word-art="true" className={`wr-word-leaf wr-leaf-color-${index % 4}${picked === word.wordId ? " is-picked" : ""}`} key={word.wordId} style={style(index,{"--tilt":`${[-8,7,-4,9,5,-7,6,-5][index%8]}deg`})} aria-pressed={picked===word.wordId} aria-label={`${word.text}，本周 ${word.count} 次模糊或忘记，点击${picked===word.wordId ? "收起" : "展开记录"}`} onClick={() => pick(picked===word.wordId ? null : word.wordId)}>
        <span className="wr-leaf-pin" aria-hidden="true"/>
        <span className="wr-leaf-ink" aria-hidden="true"/>
        <b className={`wr-leaf-word${word.text.length>8 ? " is-long" : ""}`} lang="ja">{word.text}</b>
        {picked === word.wordId && <small className="wr-leaf-detail" aria-hidden="true">{word.count} 次模糊或忘记</small>}
        <span className="wr-leaf-mark" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
      </button>)}
    </div>
    <div className="wr-word-caption" aria-live="polite">
      {chosen ? <><span><b lang="ja">{chosen.text}</b> · {chosen.count} 次模糊或忘记</span>{onReviewWords && <button className="wr-inline-action" onClick={() => onReviewWords([chosen.wordId])}>再练这个词 <ArrowUpRight size={14} /></button>}</> : <span>轻触一个词，看看这周的相遇。</span>}
    </div>
    {onReviewWords && <button className="wr-scene-action" onClick={() => onReviewWords(words.map(word=>word.wordId))}>和这些词，再见一面 <ArrowUpRight size={16} /></button>}
  </>;
}

export function WeeklyReportStory({ report, chapter, onBack, onReviewWords, onShare, animate = true }: {
  report: WeeklyReport; chapter: string; onBack: () => void;
  onReviewWords?: (ids: number[]) => void; onShare: () => void; animate?: boolean;
}) {
  const { metrics, highlight } = report;
  const count = (value:number) => <Count value={value} animate={animate} />;
  const modes = [{label:"单词",value:metrics.wordReviews,glyph:"あ"},{label:"语法",value:metrics.grammarReviews,glyph:"文"},{label:"汉字读音",value:metrics.kanjiReviews,glyph:"字"}];
  return <article className={`weekly-report-story wr-story-${chapter}`} aria-label={weeklyChapters(report).find(item=>item.id===chapter)?.label}>
    <Dust />
    {chapter === "cover" && <>
      <div className="wr-cover-orbit" aria-hidden="true"><span /><span /><span /><i className="wr-orbit-star">✦</i></div>
      <div className="wr-scene-copy wr-cover-copy">
        <p className="wr-kicker">SHUSHUGO / 你与日语的这一周</p>
        <h1 className="wr-cover-title"><span>一页一日</span><em>慢慢成林</em><i aria-hidden="true">。</i></h1>
        <p className="wr-hand-note">散落在日常里的字，<br />在这里，长成你的风景。</p>
        <p className="wr-cover-fact">这周，有 <strong>{count(metrics.days)}</strong> 天<br /><span>你来过，就留下了一片新绿。</span></p>
        {report.keyword && <span className="wr-keyword-stamp"><small>本周的你</small><b>{report.keyword.keyword}</b></span>}
      </div>
      <div className="wr-cover-installation" aria-hidden="true">
        <div className="wr-paper-landscape"><i className="wr-paper-back"/><i className="wr-paper-middle"/><div className="wr-paper-front"><span className="wr-paper-sun"/><span className="wr-paper-hill"/><b>日</b><small>ことばの庭</small></div></div>
        <div className="wr-cover-ticket"><span>学习的日子</span><b>{String(metrics.days).padStart(2,"0")}</b></div>
        <span className="wr-paper-sprig"><i/><i/><i/></span><span className="wr-floating-glyph">あ</span>
      </div>
      <p className="wr-scene-margin" aria-hidden="true">A LITTLE GARDEN OF WORDS.</p>
    </>}
    {chapter === "effort" && <>
      <div className="wr-scene-copy">
        <p className="wr-kicker">01 / 时间的形状</p><h2 className="wr-scene-title"><span>时间流过</span><em>留下了你。</em></h2>
        <p className="wr-story-prose">在零碎的日常里，<br />你把这些时间，留给了日语。</p>
      </div>
      <div className="wr-time-universe">
        <div className="wr-time-ring" aria-hidden="true"><i /><i /><i /></div>
        <div className="wr-time-number"><strong>{metrics.totalSeconds<60 ? "不足 1" : count(metrics.minutes)}</strong><span>分钟 / 这一周</span></div>
        <span className="wr-time-star" aria-hidden="true">✧</span>
      </div>
      <div className="wr-time-bottom">
        <div className="wr-week-wave" role="img" aria-label={metrics.daily.map(day=>`周${weekday(day.date)} ${day.reviews} 次作答`).join("，")+"。周日合并首尾两个半天。"}>
          {metrics.daily.map((day,i)=><div key={day.date} style={style(i)} aria-hidden="true"><span>{number(day.reviews)}</span><i style={{height:`${72*(day.reviews/Math.max(1,...metrics.daily.map(d=>d.reviews)))}px`}} /><small>{weekday(day.date)}</small></div>)}
        </div>
        <p><b>{number(metrics.totalReviews)}</b> 次作答，散落在这一周。<small>图中每日数字为实际作答；周日为首尾两个半天之和。</small></p>
      </div>
    </>}
    {chapter === "content" && <>
      <div className="wr-letter-weather" aria-hidden="true">{["あ","語","の","学","ふ","言","え","文"].map((glyph,i)=><span key={i} style={style(i)}>{glyph}</span>)}</div>
      <div className="wr-scene-copy"><p className="wr-kicker">02 / 字间相遇</p><h2 className="wr-scene-title"><span>{metrics.newWords ? "从陌生" : "从熟悉"}</span><em>到慢慢熟悉。</em></h2></div>
      <div className="wr-new-words"><strong>{count(metrics.newWords)}</strong><span>个单词<br /><b>{metrics.newWords ? "这周，第一次与你相遇。" : "这一周，把时间留给熟悉的词。"}</b></span></div>
      <div className="wr-mode-collage">{modes.map((mode,i)=><div key={mode.label} style={style(i)}><span className="wr-mode-glyph" aria-hidden="true">{mode.glyph}</span><span>{mode.label}<b>{number(mode.value)}<small> 次作答</small></b></span><i aria-hidden="true">✳</i></div>)}</div>
      <p className="wr-content-note">还有 <b>{number(metrics.reviewCount)}</b> 次再次练习，<br />让相遇，变得更熟悉。</p>
    </>}
    {chapter === "highlight" && highlight && <>
      <div className="wr-memory-rays" aria-hidden="true"><i /><i /><i /></div>
      <div className="wr-scene-copy"><p className="wr-kicker">这一周 / 有一刻想替你记得</p><h2 className="wr-scene-title"><span>这一刻</span><em>留在光里。</em></h2></div>
      <div className="wr-memory-frame">
        <div className="wr-memory-picture" aria-hidden="true"><span className="wr-memory-sun" /><span className="wr-memory-sea" /><span className="wr-memory-orbit">✦</span><span className="wr-memory-word">日</span></div>
        <div className="wr-memory-writing"><time dateTime={highlight.date}>{new Date(`${highlight.date}T12:00:00`).getMonth()+1}<i>/</i>{String(new Date(`${highlight.date}T12:00:00`).getDate()).padStart(2,"0")}</time><p>{highlight.text}</p></div>
        <span className="wr-memory-tape" aria-hidden="true" />
      </div>
      <p className="wr-memory-caption">不急着往前。<br />这一页，先为你停一停。</p>
    </>}
    {chapter === "revisit" && <>
      <div className="wr-scene-copy wr-garden-heading"><p className="wr-kicker">字间小院 / 还想再见的你</p><h2 className="wr-scene-title"><span>有些词</span><em>想再见一面。</em></h2><p className="wr-story-prose">还没记熟，也已经在这里生了根。</p></div>
      <WordGarden words={report.revisitWords} onReviewWords={onReviewWords} />
    </>}
    {chapter === "end" && <>
      <div className="wr-ending-orbit" aria-hidden="true"><i /><i /><span>✦</span></div>
      <div className="wr-scene-copy"><p className="wr-kicker">留一页 / 给下周</p><h2 className="wr-scene-title"><span>这一页收好</span><em>下周，继续长。</em></h2><p className="wr-story-prose">到这周为止，你走过 <b>{number(metrics.cumulativeDays)}</b> 个学习日，<br />与 <b>{number(metrics.cumulativeWords)}</b> 个词，见过第一面。</p></div>
      <div className="wr-ending-book" aria-hidden="true"><i/><i/><div><span>日々</span><b>またね</b><span className="wr-book-leaf"/></div></div>
      <div className="wr-ending-actions"><button className="wr-scene-action" onClick={onShare}>收好这一周 <ArrowUpRight size={16}/></button><button className="wr-inline-action" onClick={onBack}>回到日常</button></div>
      <p className="wr-ending-signature">每一次相遇，都算数。<span>SHUSHUGO / 日々</span></p>
    </>}
  </article>;
}
