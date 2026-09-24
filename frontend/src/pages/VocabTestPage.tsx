import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, History, ListChecks, Pause, Play, RotateCcw, Share2, ShieldCheck, Timer, X } from "lucide-react";
import { Sticker, type StickerName } from "../components/CapybaraMascot";
import {
  finishVocabTest,
  getVocabTestHistory,
  getVocabTestResult,
  getVocabTestSession,
  recordVocabTestRun,
  startVocabTest,
  submitVocabTestAnswer,
  secondsForQuestion,
  VOCAB_TEST_LEVELS,
  VOCAB_TEST_SECONDS,
  type VocabTestAnswerState,
  type VocabTestHistoryRow,
  type VocabTestQuestion,
  type VocabTestResult,
  type VocabTestSession
} from "../lib/vocab-test";
import { renderVocabShareCard } from "../features/vocab-test/share-card";
import { MascotSay } from "../components/MascotSay";
import { ShareImageSheet } from "../components/ShareImageSheet";
import { useStudyTimer } from "../lib/useStudyTimer";

type View = "intro" | "quiz" | "result";

/** 答完一题，吉祥物怎么说：对了欢呼，错了想不通，不认识 / 超时各有各的表情 */
const FEEDBACK: Record<VocabTestAnswerState, { sticker: StickerName; tone: "good" | "warn"; label: string }> = {
  correct: { sticker: "mood-yay", tone: "good", label: "答对了！" },
  wrong: { sticker: "mood-puzzled", tone: "warn", label: "这题选错了" },
  unknown: { sticker: "mood-ask", tone: "warn", label: "记为不认识，不扣分" },
  timeout: { sticker: "mood-dizzy", tone: "warn", label: "超时了，记为不认识" }
};

/** 每题的倒计时：一圈细环，最后 5 秒变暖色。切走时环停住、中间换成暂停符号。 */
const TimerRing = ({ remaining, total, paused }: { remaining: number; total: number; paused: boolean }) => {
  const circumference = 97.4; // 2π × 15.5
  const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <span className={`vt-timer ${remaining <= 5 && !paused ? "is-low" : ""}`} role="timer" aria-label={paused ? "已暂停" : `剩 ${remaining} 秒`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" className="vt-timer-track" />
        <circle cx="18" cy="18" r="15.5" className="vt-timer-fill" style={{ strokeDasharray: `${ratio * circumference} ${circumference}` }} />
      </svg>
      <b>{paused ? <Pause size={13} /> : remaining}</b>
    </span>
  );
};

const QuestionCard = ({
  question,
  disabled,
  onChoose,
  feedback,
  next
}: {
  question: VocabTestQuestion;
  disabled: boolean;
  onChoose: (index: number | null) => void;
  feedback: { state: VocabTestAnswerState; selected: number | null } | null;
  /** 答完之后「不认识」那一格换成「下一题」：拇指不用挪，手机上也不会被推到底栏下面 */
  next: { label: string; onClick: () => void };
}) => (
  <div className="ds-card vt-card">
    <div className="flex items-center gap-1.5">
      <span className="ds-pill">{question.kind === "reading" ? "读音题" : "释义题"}</span>
      <span className="ds-pill">{question.level}</span>
    </div>
    <p className="vt-prompt">{question.prompt}</p>
    <p className="vt-ask">
      {/* 拆掉送假名的题必须说清楚在问哪几个字，否则「培う 选 つちか」看着像少打了一个字 */}
      {question.kind !== "reading"
        ? "选出它的中文意思"
        : question.readingScope
          ? `选出「${question.readingScope}」的读音（送假名已给出）`
          : "选出它的读音"}
    </p>
    <div className="ds-choices">
      {question.options.map((option, index) => {
        const isCorrect = feedback && index === question.answerIndex;
        const isSelected = feedback && index === feedback.selected;
        return (
          <button
            key={`${question.id}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(index)}
            className={`ds-choice focus-ring ${isCorrect ? "is-correct" : isSelected ? "is-wrong" : ""}`}
          >
            <span className="ds-choice-key">{index + 1}</span>
            <span className="min-w-0 flex-1">{option}</span>
            {isCorrect && <Check size={16} className="shrink-0" />}
            {isSelected && !isCorrect && <X size={16} className="shrink-0" />}
          </button>
        );
      })}
    </div>
    {feedback ? (
      <button type="button" onClick={next.onClick} className="ds-btn focus-ring mt-2.5 w-full">{next.label} →</button>
    ) : (
      <button type="button" disabled={disabled} onClick={() => onChoose(null)} className="vt-unknown focus-ring">不认识</button>
    )}
  </div>
);

/**
 * ⚠️ 少于这个题数不摆数字。
 *
 * 估计量本身没问题：一个等级一题没答，方差就按该等级词数的平方算，区间自然撑满。
 * 但那意味着答 2 题会得到「0 – 8,482」—— 数学上诚实，摆出来却是在胡说。
 * 门槛取 15：五个等级各摊三题，每个等级至少有话可说。
 */
const MIN_ANSWERS_FOR_ESTIMATE = 15;

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
};

const formatWhen = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 列表里用的短日期：今年的不写年份（「9月23日 23:03」），一行放得下 */
const formatShort = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear() === new Date().getFullYear() ? "" : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 搁置超过这个时长就建议重测（半小时：够上个厕所，不够换一个人的状态） */
const STALE_RESUME_MS = 30 * 60 * 1000;

/** 「搁了不到一分钟」不该有空格，「搁了 12 分钟」该有 —— 数字前才留。 */
const joinGap = (prefix: string, gap: string): string => `${prefix}${/^\d/.test(gap) ? " " : ""}${gap}`;

const formatGap = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "不到一分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时` : `${Math.round(hours / 24)} 天`;
};

const dateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * 分享 = 出一张图，和打卡分享同一块底座（lib/share-canvas），不是发一行字。
 * 落地页的「分享」、历史每一行、结果页三处共用这一份。
 */
const useVocabShare = () => {
  const [notice, setNotice] = useState("");
  const [card, setCard] = useState<{ url: string; blob: Blob; row: VocabTestHistoryRow } | null>(null);
  const [busy, setBusy] = useState<"render" | null>(null);

  const share = async (row: VocabTestHistoryRow) => {
    if (busy) return;
    setBusy("render");
    setNotice("");
    try {
      const blob = await renderVocabShareCard({
        date: dateKey(row.finishedAt),
        estimated: row.estimated,
        lower: row.lower,
        upper: row.upper,
        answered: row.answered,
        totalQuestions: row.totalQuestions,
        durationSeconds: row.durationSeconds,
        confidence: row.confidence,
        recommendation: row.recommendation || "N1+",
        // 早一版的记录没存各级数据，那就只画空槽，不假造
        levels: row.levels.length ? row.levels : VOCAB_TEST_LEVELS.map((level) => ({ level, rate: null, answered: 0 }))
      });
      if (card) URL.revokeObjectURL(card.url);
      setCard({ url: URL.createObjectURL(blob), blob, row });
    } catch {
      setNotice("图片生成失败，再试一次");
    } finally {
      setBusy(null);
    }
  };

  const fileName = card ? `shushugo-vocab-${dateKey(card.row.finishedAt)}.png` : "shushugo-vocab.png";

  const close = () => {
    if (card) URL.revokeObjectURL(card.url);
    setCard(null);
    setNotice("");
  };

  const sheet = card ? (
    <ShareImageSheet title="词汇量分享图" url={card.url} alt="词汇量分享图" blob={card.blob} fileName={fileName} shareTitle="我的日语词汇量" onClose={close} />
  ) : null;
  /** 没弹出图时的提示（生成失败）要摆在页面上，不然没人看得见 */
  return { share, busy, sheet, pageNotice: card ? "" : notice };
};

/** 答题太少的那几次不算成绩：历史里写「题太少」，也不拿它当「最近一次」 */
const hasEstimate = (row: VocabTestHistoryRow) => row.answered >= MIN_ANSWERS_FOR_ESTIMATE;

/**
 * 查词汇量的「第二主页」：进测验的入口 + 过去测过几次 + 这个数怎么算出来的。
 *
 * 规则那一段是**必要的**，不是装饰：这个数天然会被当成「我的日语水平」到处说，
 * 而它只是 JLPT 词表范围内的抽样外推。把口径摆在进门的地方，比在结果页写一行小字管用。
 */
const VocabTestHome = ({
  history, resumable, resumeProgress, resumeStartedAt, resumeIdleMs, error, onResume, onStart, onOpenResult, hasResult, onShare, shareBusy, shareNotice
}: {
  history: VocabTestHistoryRow[];
  resumable: boolean;
  resumeProgress: string;
  /** 未答完的那场是什么时候开的、上一次作答离现在多久（毫秒） */
  resumeStartedAt: number;
  resumeIdleMs: number;
  error: string;
  onResume: () => void;
  onStart: () => void;
  onOpenResult: () => void;
  hasResult: boolean;
  onShare: (row: VocabTestHistoryRow) => void;
  shareBusy: boolean;
  shareNotice: string;
}) => {
  const latest = history.find(hasEstimate) ?? null;
  const stale = resumeIdleMs >= STALE_RESUME_MS;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <section className="ds-card vt-hero">
        <div className="vt-hero-row">
          <div className="min-w-0 flex-1">
            {latest ? (
              <>
                <p className="ds-kicker">上次测出 · {formatShort(latest.finishedAt)}</p>
                <p className="vt-big">{latest.estimated.toLocaleString()}<small>词</small></p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="ds-pill">{latest.answered} 题 · {formatDuration(latest.durationSeconds)}</span>
                  <span className="ds-pill ds-pill-primary">可信度 {latest.confidence}%</span>
                </div>
              </>
            ) : (
              <>
                <p className="ds-kicker">查词汇量</p>
                <h2 className="vt-title">我认识多少日语词？</h2>
                <p className="vt-sub">跨 N5–N1 抽样，估计 JLPT 词表里你认识多少词。</p>
              </>
            )}
          </div>
          <Sticker name="scene-laptop" size={92} className="vt-hero-mascot" />
        </div>

        <div className="vt-facts">
          <span className="ds-pill"><ListChecks size={13} />约 60 题 · 随时交卷</span>
          <span className="ds-pill"><Timer size={13} />每题 {VOCAB_TEST_SECONDS.reading} / {VOCAB_TEST_SECONDS.meaning} 秒 · 切走暂停</span>
          <span className="ds-pill"><ShieldCheck size={13} />不影响学习记录</span>
        </div>

        {resumable && (
          /* ⚠️ 隔了很久再接着答，前后半场不是同一个状态（也不是同一天的水平），
             结果会带误差。所以这里必须把「什么时候开的、隔了多久」摆出来，
             让用户自己决定接着答还是重测 —— 而不是默默把两段拼成一次成绩。 */
          <MascotSay sticker={stale ? "mood-puzzled" : "mood-ask"} tone={stale ? "warn" : "info"} className="mt-4">
            上次答到 <b>{resumeProgress}</b>，开始于 {formatWhen(resumeStartedAt)}。
            {stale
              ? `${joinGap("已经搁了", formatGap(resumeIdleMs))}，接着答会把两段不同状态拼成一次成绩，建议重测。`
              : `${joinGap("搁了", formatGap(resumeIdleMs))}，接着答就行。`}
          </MascotSay>
        )}
        {error && <div role="alert"><MascotSay sticker="mood-dizzy" tone="warn" className="mt-4">{error}</MascotSay></div>}
        {shareNotice && <div role="status"><MascotSay sticker="mood-dizzy" tone="warn" className="mt-4">{shareNotice}</MascotSay></div>}

        <div className="mt-4 grid gap-2">
          {resumable ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onResume} className={`focus-ring ${stale ? "ds-btn-soft" : "ds-btn"}`}><Play size={16} />继续测验</button>
              <button type="button" onClick={onStart} className={`focus-ring ${stale ? "ds-btn" : "ds-btn-soft"}`}><RotateCcw size={16} />重新开始</button>
            </div>
          ) : (
            <button type="button" onClick={onStart} className="ds-btn focus-ring w-full">开始测验 →</button>
          )}
          {(hasResult || latest) && (
            <div className="flex gap-2">
              {hasResult && <button type="button" onClick={onOpenResult} className="ds-btn-soft focus-ring flex-1">上次的详细结果</button>}
              {latest && (
                <button type="button" onClick={() => onShare(latest)} disabled={shareBusy} className="ds-btn-soft focus-ring flex-1 disabled:opacity-60">
                  <Share2 size={16} />分享成绩
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="ds-card p-4 sm:p-5">
        <h3 className="vt-h3"><History size={16} />过去的成绩</h3>
        {history.length ? (
          <ul className="mt-2">
            {history.map((row, index) => {
              const valid = hasEstimate(row);
              const older = valid ? history.slice(index + 1).find(hasEstimate) : undefined;
              const delta = older ? row.estimated - older.estimated : 0;
              return (
                <li key={row.runId} className="vt-hist-row">
                  <div className="min-w-0 flex-1">
                    <p className="vt-hist-num">
                      {valid ? <>{row.estimated.toLocaleString()}<small>词</small></> : <span className="ds-pill ds-pill-warn">题太少，没出数</span>}
                      {delta !== 0 && <span className={`ds-pill ${delta > 0 ? "ds-pill-primary" : ""}`}>{delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString()}</span>}
                      {valid && <span className="ds-pill">可信度 {row.confidence}%</span>}
                    </p>
                    <p className="vt-hist-meta">
                      {formatShort(row.finishedAt)} · {row.answered}/{row.totalQuestions} 题 · {formatDuration(row.durationSeconds)}
                    </p>
                  </div>
                  {valid && (
                    <button type="button" onClick={() => onShare(row)} disabled={shareBusy} className="ds-icon-btn focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full" aria-label="分享这次成绩">
                      <Share2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-2 flex items-center gap-3 text-sm vt-muted"><Sticker name="empty-box" size={56} className="shrink-0" />还没有记录。测一次就会留在这里。</div>
        )}
      </section>

      <section className="ds-card p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Sticker name="mood-ask" size={52} className="shrink-0" />
          <div>
            <h3 className="vt-h3">这个数是怎么算出来的</h3>
            <p className="ds-kicker mt-0.5">仅供参考，别当成体检报告</p>
          </div>
        </div>
        <ul className="vt-rules">
          <li><b>抽样外推</b>：N5–N1 每级抽十几道，各级答对率乘以该级词表规模再相加。所以它是<b>当前 JLPT 词表范围内</b>的估计，不是「全日语词汇量」。</li>
          <li><b>四选一，蒙也能蒙对</b>：所以每级得分按「答对 − 答错 ÷ 3」折算，<b>答错会把这一级的分数往下压</b>，不是简单不计分。</li>
          <li><b>不认识就点「不认识」</b>：它不扣分，也不算你蒙。真不会却硬猜，反而会同时拉低词汇量和可信度。</li>
          <li><b>可信度</b> = 答题量（60）+ 没在赶进度（40），再<b>乘以</b>「有多少作答其实是蒙的」的补数；越难的级别反而答得越好，每处再扣 8 分。所以全靠蒙的话，题答得再多可信度也接近 0。</li>
          <li><b>超时按不认识记</b>，超时太多同样降可信度。切到别的页面会自动暂停，不算你超时。</li>
          <li>少于 15 题不给估计值：一个等级一题没答，区间会撑到整份词表那么宽，那个数是没意义的。</li>
        </ul>
      </section>
    </div>
  );
};

/** 可信度偏低时，吉祥物说一句为什么（超时多 / 蒙得多），不然用户只看见一个低百分比 */
const confidenceHint = (result: VocabTestResult): string | null => {
  if (result.confidence >= 60) return null;
  if (result.timeoutShare >= 0.2) return `可信度只有 ${result.confidence}%：超时的题有点多。下次不会的题直接点「不认识」，别等它倒数完。`;
  if (result.guessedShare >= 0.2) return `可信度只有 ${result.confidence}%：看起来蒙的题不少。不会就点「不认识」——它不扣分，结果反而更准。`;
  return `可信度只有 ${result.confidence}%：题答得还不够多。答满 60 题，数字会稳很多。`;
};

const ResultView = ({ result, row, onRestart, onBack, onShare, shareBusy }: {
  result: VocabTestResult;
  row: VocabTestHistoryRow | null;
  onRestart: () => void;
  onBack: () => void;
  onShare: (row: VocabTestHistoryRow) => void;
  shareBusy: boolean;
}) => {
  const enough = result.answered >= MIN_ANSWERS_FOR_ESTIMATE;
  const hint = enough ? confidenceHint(result) : null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <section className="ds-card vt-hero">
        <div className="vt-hero-row">
          <div className="min-w-0 flex-1">
            <p className="ds-kicker">{enough ? "这次测出" : "这次还没出数"}</p>
            {enough ? (
              <>
                {/* 摆点估计，不摆区间。区间退到底下那行小字 ——
                    「3,860 – 6,402」这种宽度读不出任何东西，用户宁可要一个具体数字。 */}
                <p className="vt-big">{result.estimated.toLocaleString()}<small>词</small></p>
                <p className="vt-sub"><span className="whitespace-nowrap">区间 {result.lower.toLocaleString()}–{result.upper.toLocaleString()}</span> · <span className="whitespace-nowrap">JLPT 词表范围内</span></p>
              </>
            ) : (
              <h2 className="vt-title">答得还太少</h2>
            )}
          </div>
          <Sticker name={!enough ? "mood-ask" : hint ? "mood-puzzled" : "mood-proud"} size={96} className="vt-hero-mascot" />
        </div>
        {!enough && (
          <MascotSay sticker="scene-book" tone="warn" size={48} className="mt-3">
            只答了 <b>{result.answered}</b> 题，还有等级一题没碰过，给不出有意义的区间。至少答满 {MIN_ANSWERS_FOR_ESTIMATE} 题（五个等级各三题左右）再看结果。
          </MascotSay>
        )}
        <div className="vt-stats">
          <div><b>{result.answered}</b><span>已答题</span></div>
          <div><b>{result.confidence}%</b><span>可信度</span></div>
          <div><b>{enough ? result.recommendation : "—"}</b><span>建议从这级继续</span></div>
        </div>
      </section>

      {hint && <MascotSay sticker="mood-dizzy" tone="warn" className="ds-say-onbg">{hint}</MascotSay>}

      <section className="ds-card p-4 sm:p-5">
        <h3 className="vt-h3">各级表现</h3>
        <div className="mt-3 space-y-2.5">
          {result.levels.map((level) => (
            <div key={level.level} className="vt-level">
              <b>{level.level}</b>
              {/* 没答过的等级画空槽写「未答」，不画成 0% —— 那是两件事 */}
              <div className="ds-bar flex-1"><i style={{ width: `${level.rate ? Math.max(4, level.rate * 100) : 0}%` }} /></div>
              <span className={level.rate == null ? "vt-muted" : ""}>{level.rate == null ? "未答" : `${Math.round(level.rate * 100)}%`}</span>
              <small>{level.answered} 题</small>
            </div>
          ))}
        </div>
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="ds-btn-soft focus-ring">返回</button>
        {enough && row && (
          <button type="button" onClick={() => onShare(row)} disabled={shareBusy} className="ds-btn-soft focus-ring flex-1 disabled:opacity-60"><Share2 size={16} />分享</button>
        )}
        <button type="button" onClick={onRestart} className="ds-btn focus-ring flex-1"><RotateCcw size={15} />再测一次</button>
      </div>
    </div>
  );
};

export function VocabTestPage() {
  const [session, setSession] = useState<VocabTestSession | null>(() => getVocabTestSession());
  /**
   * ⚠️ **进这一页永远先看落地页**（成绩 + 历史 + 规则 + 开始按钮），一个例外都没有。
   *
   * 踩过两次：
   *  - 「上一场已经结束」就把结果页顶上来 → 点「查词汇量」看到的是一张
   *    「答得还太少 · 只答了 0 题」的旧结果，而不是这个功能的门面；
   *  - 「上一场没答完」就直接跳回题目 → **那条「本次测试于 xx 开始、搁了多久、
   *    要不要重测」的提示就永远没机会出现**，而它正是为「隔天回来接着答」写的。
   *
   * 结果页只有两条路进：刚测完，或者在落地页点「上次的详细结果」；
   * 半途那场也只从落地页的「继续测验」进去。
   */
  const [view, setView] = useState<View>("intro");
  const [feedback, setFeedback] = useState<{ question: VocabTestQuestion; state: VocabTestAnswerState; selected: number | null } | null>(null);
  const [remaining, setRemaining] = useState(15);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<VocabTestHistoryRow[]>([]);
  const [openedAt] = useState(Date.now);
  const questionStartedAt = useRef(0);
  const hiddenAt = useRef(0);

  const refreshHistory = useCallback(() => setHistory(getVocabTestHistory()), []);
  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  const question = useMemo(() => {
    if (!session || session.currentIndex >= session.questions.length) return null;
    return session.questions[session.currentIndex];
  }, [session]);

  /**
   * ⚠️ 展示用的题必须是**刚答完那一道**，不是当前指针指的那道。
   *
   * `submitVocabTestAnswer` 一提交就把 currentIndex 推到下一题，所以答完的瞬间
   * `question` 已经换人了。照 `question` 渲染的话：新题的题面冒出来、
   * 新题的正确项被 feedback 标成绿色（「还没点就出答案」）、
   * 底下那行还写着上一题的答案。三个现象是同一个 bug。
   */
  const shownQuestion = feedback ? feedback.question : question;
  useStudyTimer(view === "quiz" && Boolean(question));

  const choose = useCallback((selected: number | null) => {
    if (!question || feedback || paused) return;
    const state: VocabTestAnswerState = selected == null
      ? "unknown"
      : selected === question.answerIndex ? "correct" : "wrong";
    const next = submitVocabTestAnswer(state, selected, Date.now() - questionStartedAt.current);
    if (!next) return;
    setSession(next);
    setFeedback({ question, state, selected });
  }, [feedback, paused, question]);

  useEffect(() => {
    if (view !== "quiz" || !question) return;
    questionStartedAt.current = Date.now();
    setRemaining(secondsForQuestion(question));
  }, [view, question]);

  /**
   * 切走 = 暂停，**而且回来之后要把这段时间从本题用时里减掉**。
   *
   * 计时器停了不等于账没记：`questionStartedAt` 还停在原地，回来一答，
   * 这题的 responseMs 就把「人不在的那段」算了进去。历史里那条
   * 「2 题 · 用时 4160 分」就是这么来的（记录侧也做了封顶兜底，两头都堵）。
   */
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState !== "visible";
      setPaused(hidden);
      if (hidden) {
        hiddenAt.current = Date.now();
        return;
      }
      if (hiddenAt.current) {
        questionStartedAt.current += Date.now() - hiddenAt.current;
        hiddenAt.current = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (view !== "quiz" || !question || feedback || paused) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          const currentQuestion = question;
          const next = submitVocabTestAnswer("timeout", null, Date.now() - questionStartedAt.current);
          if (next) {
            setSession(next);
            setFeedback({ question: currentQuestion, state: "timeout", selected: null });
          }
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [feedback, paused, question, view]);

  useEffect(() => {
    if (view !== "quiz" || feedback || !question) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || paused) return;
      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        choose(null);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < question.options.length) {
        event.preventDefault();
        choose(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, feedback, paused, question, view]);

  const begin = (restart: boolean) => {
    setError("");
    try {
      const next = startVocabTest();
      setSession(next);
      setFeedback(null);
      setPaused(false);
      setView("quiz");
    } catch {
      // 词库太小的情况在正式 App 中不应发生；保留当前页面，不伪造结果。
      setError("当前词库可用于测验的词太少，暂时无法开始。");
      if (restart) setView("intro");
    }
  };

  const atEnd = Boolean(session && (
    session.finishedAt || (session.currentIndex >= session.questions.length && session.questions.length >= session.plannedTotal)
  ));

  const nextQuestion = () => {
    if (!session) return;
    setFeedback(null);
    if (atEnd) {
      setView("result");
      return;
    }
    // 计时和响应时长都要在**关掉反馈那一刻**重置：question 早在提交时就换了，
    // 那个 effect 不会再触发，不重置的话下一题的用时里含着读反馈的时间。
    questionStartedAt.current = Date.now();
    if (question) setRemaining(secondsForQuestion(question));
  };

  const stop = () => {
    const next = finishVocabTest();
    if (!next) return;
    setSession(next);
    setFeedback(null);
    setView("result");
  };

  const result = getVocabTestResult(session);

  // 测完就记一笔。按 run_id 幂等，所以结果页来回进出、刷新都只有一行。
  useEffect(() => {
    if (view !== "result" || !session?.finishedAt) return;
    recordVocabTestRun(session);
    refreshHistory();
  }, [view, session, refreshHistory]);

  const vocabShare = useVocabShare();
  const shareBusy = vocabShare.busy !== null;

  if (view === "result" && result) {
    return (
      <>
        <ResultView
          result={result}
          row={history.find((row) => row.runId === session?.runId) ?? null}
          onRestart={() => begin(true)}
          onBack={() => setView("intro")}
          onShare={(row) => void vocabShare.share(row)}
          shareBusy={shareBusy}
        />
        {vocabShare.sheet}
      </>
    );
  }

  if (view === "intro" || !session || !shownQuestion) {
    const resumable = Boolean(session && !session.finishedAt && session.responses.length > 0);
    return (
      <>
        <VocabTestHome
          history={history}
          resumable={resumable}
          resumeProgress={session ? `${session.responses.length} / ${session.plannedTotal}` : ""}
          resumeStartedAt={session?.startedAt ?? 0}
          resumeIdleMs={session ? openedAt - (session.responses[session.responses.length - 1]?.answeredAt ?? session.startedAt) : 0}
          error={error}
          onResume={() => { setView("quiz"); setFeedback(null); }}
          onStart={() => begin(resumable)}
          onOpenResult={() => setView("result")}
          hasResult={Boolean(result) && (session?.responses.length ?? 0) > 0}
          onShare={(row) => void vocabShare.share(row)}
          shareBusy={shareBusy}
          shareNotice={vocabShare.pageNotice}
        />
        {vocabShare.sheet}
      </>
    );
  }

  // ⚠️ 分母是 plannedTotal 不是 questions.length：摸底阶段只出好了 20 道，
  // 拿它当分母，进度条会在第 20 题冲到 100% 然后倒回去。
  const progress = Math.round((session.responses.length / session.plannedTotal) * 100);
  const said = feedback ? FEEDBACK[feedback.state] : null;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="vt-quiz-top">
        <div className="min-w-0 flex-1">
          <p className="vt-count"><b>{session.responses.length}</b> / {session.plannedTotal}</p>
          <div className="ds-bar mt-1.5"><i style={{ width: `${progress}%` }} /></div>
        </div>
        <TimerRing remaining={remaining} total={shownQuestion ? secondsForQuestion(shownQuestion) : 0} paused={paused} />
        <button type="button" onClick={stop} className="ds-chip focus-ring">提前交卷</button>
      </div>
      <QuestionCard
        question={shownQuestion}
        disabled={Boolean(feedback) || paused}
        onChoose={choose}
        feedback={feedback ? { state: feedback.state, selected: feedback.selected } : null}
        next={{ label: atEnd ? "查看结果" : "下一题", onClick: nextQuestion }}
      />
      {paused && (
        <MascotSay sticker="mood-sleep" size={52} className="ds-say-onbg mt-3">切走了，计时先停着。回到这页就接着算。</MascotSay>
      )}
      {feedback && said && (
        <MascotSay sticker={said.sticker} tone={said.tone} size={56} className="ds-say-onbg mt-3">
          <b>{said.label}</b>{feedback.state !== "correct" && <> 答案是「<b>{feedback.question.answer}</b>」。</>}
        </MascotSay>
      )}
    </div>
  );
}
