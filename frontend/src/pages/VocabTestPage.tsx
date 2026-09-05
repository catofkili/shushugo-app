import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, History, ImageDown, Loader2, Pause, Play, RotateCcw, Share2, X } from "lucide-react";
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
import { saveImageToGallery, shareImage } from "../lib/share-image";
import { renderVocabShareCard } from "../features/vocab-test/share-card";

type View = "intro" | "quiz" | "result";

const answerLabel = (state: VocabTestAnswerState): string => {
  if (state === "correct") return "答对了";
  if (state === "unknown") return "记为不认识";
  if (state === "timeout") return "超时，记为不认识";
  return "这题选错了";
};

const answerClass = (state: VocabTestAnswerState): string => {
  if (state === "correct") return "vocab-fb-correct";
  if (state === "unknown" || state === "timeout") return "vocab-fb-unknown";
  return "vocab-fb-wrong";
};

const QuestionCard = ({
  question,
  disabled,
  onChoose,
  feedback
}: {
  question: VocabTestQuestion;
  disabled: boolean;
  onChoose: (index: number | null) => void;
  feedback: { state: VocabTestAnswerState; selected: number | null } | null;
}) => (
  <div className="dictionary-card rounded-3xl p-4 shadow-xl sm:p-6">
    <div className="mb-5 flex items-center justify-between gap-3 text-xs font-bold text-white/55">
      <span>{question.kind === "reading" ? "读音题" : "释义题"}</span>
      <span>{question.level}</span>
    </div>
    <div className="grid min-h-[130px] place-items-center vocab-prompt-panel rounded-2xl px-4 py-8 text-center">
      <p className="font-serif text-4xl font-extrabold tracking-wide sm:text-5xl">
        {question.prompt}
      </p>
      <p className="mt-3 text-xs font-semibold text-white/45">
        {/* 拆掉送假名的题必须说清楚在问哪几个字，否则「培う 选 つちか」看着像少打了一个字 */}
        {question.kind !== "reading"
          ? "请选择中文释义"
          : question.readingScope
            ? `请选择「${question.readingScope}」的读音（送假名已给出）`
            : "请选择假名读音"}
      </p>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {question.options.map((option, index) => {
        const isCorrect = feedback && index === question.answerIndex;
        const isSelected = feedback && index === feedback.selected;
        return (
          <button
            key={`${question.id}-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(index)}
            className={`focus-ring min-h-12 rounded-2xl border px-3 py-3 text-left text-sm font-bold transition ${
              isCorrect ? "border-[#81D8CF] bg-[#81D8CF]/18 text-[#81D8CF]"
                : isSelected ? "border-red-300/60 bg-red-300/10 text-red-200"
                  : "border-white/15 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] disabled:cursor-default"
            }`}
          >
            <span className="mr-2 text-xs text-white/38">{index + 1}</span>
            {option}
            {isCorrect && <Check size={15} className="float-right mt-0.5" />}
            {isSelected && !isCorrect && <X size={15} className="float-right mt-0.5" />}
          </button>
        );
      })}
    </div>
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChoose(null)}
      className={`focus-ring mt-2 min-h-11 w-full rounded-2xl border px-3 py-2.5 text-sm font-bold transition ${
        feedback?.state === "unknown" || feedback?.state === "timeout"
          ? "vocab-fb-unknown"
          : "border-white/12 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] disabled:cursor-default"
      }`}
    >
      不认识
    </button>
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
 * 查词汇量的「第二主页」：进测验的入口 + 过去测过几次 + 这个数怎么算出来的。
 *
 * 规则那一段是**必要的**，不是装饰：这个数天然会被当成「我的日语水平」到处说，
 * 而它只是 JLPT 词表范围内的抽样外推。把口径摆在进门的地方，比在结果页写一行小字管用。
 */
const VocabTestHome = ({
  history, latest, resumable, resumeProgress, resumeStartedAt, resumeIdleMs, error, onResume, onStart, onOpenResult, hasResult
}: {
  history: VocabTestHistoryRow[];
  latest: VocabTestHistoryRow | null;
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
}) => {
  const [notice, setNotice] = useState("");
  const [card, setCard] = useState<{ url: string; blob: Blob; row: VocabTestHistoryRow } | null>(null);
  const [busy, setBusy] = useState<"render" | "save" | "share" | null>(null);

  /** 分享 = 出一张图，和打卡分享同一块底座（lib/share-canvas），不是发一行字。 */
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

  const saveCard = async () => {
    if (!card || busy) return;
    setBusy("save");
    try {
      const result = await saveImageToGallery(card.blob, fileName);
      setNotice(result === "gallery" ? "已保存到相册 ✓" : "已开始下载 ✓");
    } catch {
      setNotice("保存失败，请在 设置 > 收集日里允许访问相册后重试");
    } finally {
      setBusy(null);
    }
  };

  const sendCard = async () => {
    if (!card || busy) return;
    setBusy("share");
    try {
      const result = await shareImage(card.blob, fileName, "我的日语词汇量");
      if (result === "unsupported") setNotice("当前浏览器不支持直接分享，请先保存图片");
    } catch {
      setNotice("分享失败，再试一次");
    } finally {
      setBusy(null);
    }
  };

  const closeCard = () => {
    if (card) URL.revokeObjectURL(card.url);
    setCard(null);
    setNotice("");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="dictionary-card rounded-3xl p-5 shadow-xl sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY CHECK</p>
        <h2 className="mt-2 text-2xl font-extrabold">查一下词汇量</h2>

        {latest ? (
          <div className="mt-4 rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/[0.07] p-4">
            <p className="text-xs font-bold text-white/55">最近一次 · {formatWhen(latest.finishedAt)}</p>
            <p className="mt-1 text-3xl font-extrabold text-[#81D8CF]">约 {latest.estimated.toLocaleString()} 词</p>
            <p className="mt-1 text-xs font-semibold text-white/55">
              {latest.answered} 题 · 用时 {formatDuration(latest.durationSeconds)} · 可信度 {latest.confidence}%
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-white/65">
            用一组跨 N5–N1 的抽样题，估计你在当前 JLPT 词表覆盖范围内认识多少词。还没测过。
          </p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">约 60 题</b><span className="text-xs text-white/50">可随时结束</span></div>
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">读音 {VOCAB_TEST_SECONDS.reading} 秒 · 释义 {VOCAB_TEST_SECONDS.meaning} 秒</b><span className="text-xs text-white/50">切走会暂停</span></div>
          <div className="rounded-2xl bg-white/[0.05] p-3"><b className="block">独立记录</b><span className="text-xs text-white/50">不改学习状态</span></div>
        </div>

        {resumable && (
          /* ⚠️ 隔了很久再接着答，前后半场不是同一个状态（也不是同一天的水平），
             结果会带误差。所以这里必须把「什么时候开的、隔了多久」摆出来，
             让用户自己决定接着答还是重测 —— 而不是默默把两段拼成一次成绩。 */
          <div className={`mt-4 rounded-2xl border p-3 text-sm font-semibold ${
            resumeIdleMs >= STALE_RESUME_MS
              ? "border-[#E8971C]/35 bg-[#E8971C]/[0.09] text-[#F0C68A]"
              : "border-[#81D8CF]/25 bg-[#81D8CF]/[0.07] text-[#BFF4EE]"
          }`}>
            <p>上次测验答到 {resumeProgress}，开始于 {formatWhen(resumeStartedAt)}。</p>
            <p className="mt-1 font-normal opacity-85">
              {resumeIdleMs >= STALE_RESUME_MS
                ? `${joinGap("已经搁了", formatGap(resumeIdleMs))}，接着答会让这次成绩掺进两段不同状态，建议重测。`
                : `${joinGap("搁了", formatGap(resumeIdleMs))}，接着答就行。`}
            </p>
          </div>
        )}
        {error && <p role="alert" className="mt-4 rounded-2xl border border-red-300/25 bg-red-300/[0.07] p-3 text-sm font-semibold text-red-100">{error}</p>}
        {notice && <p className="mt-3 text-center text-xs font-semibold text-[#81D8CF]">{notice}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          {resumable && (
            <button type="button" onClick={onResume} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 py-3 text-sm font-extrabold text-[#293333]">
              <Play size={16} />继续测验
            </button>
          )}
          <button
            type="button"
            onClick={onStart}
            className={`focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold ${
              resumable ? "border border-white/15 bg-white/[0.06] text-white/80" : "bg-[#81D8CF] text-[#293333]"
            }`}
          >
            <RotateCcw size={16} />{resumable ? "重新开始" : "开始测验"}
          </button>
          {latest && (
            <button type="button" onClick={() => void share(latest)} className="focus-ring inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white/80">
              <Share2 size={16} />分享
            </button>
          )}
          {hasResult && (
            <button type="button" onClick={onOpenResult} className="focus-ring inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-sm font-bold text-white/70">
              上次的详细结果
            </button>
          )}
        </div>
      </div>

      <div className="dictionary-card rounded-3xl p-5 shadow-xl sm:p-7">
        <h3 className="inline-flex items-center gap-2 text-sm font-extrabold text-white/80"><History size={15} />过去的成绩</h3>
        {history.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs text-white/45">
                <tr>
                  <th className="py-1.5 font-bold">时间</th>
                  <th className="py-1.5 font-bold">词汇量</th>
                  <th className="py-1.5 font-bold">题数</th>
                  <th className="py-1.5 font-bold">用时</th>
                  <th className="py-1.5 font-bold">可信度</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.runId} className="border-t border-white/8">
                    <td className="py-2 text-xs text-white/62">{formatWhen(row.finishedAt)}</td>
                    <td className="py-2 font-bold">{row.estimated.toLocaleString()}</td>
                    <td className="py-2 text-white/68">{row.answered}/{row.totalQuestions}</td>
                    <td className="py-2 text-white/68">{formatDuration(row.durationSeconds)}</td>
                    <td className="py-2 text-white/68">{row.confidence}%</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => void share(row)} className="focus-ring rounded-xl border border-white/15 px-2 py-1 text-xs font-bold text-white/62" aria-label="分享这次成绩">
                        <Share2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/55">还没有记录。测一次就会留在这里。</p>
        )}
      </div>

      {card && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/65 p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/15 bg-[#2f3333] p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">词汇量分享图</p>
              <button onClick={closeCard} className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/8 text-white" title="关闭">
                <X size={15} />
              </button>
            </div>
            <img src={card.url} alt="词汇量分享图" className="max-h-[62vh] w-full rounded-xl object-contain" />
            {notice && <p className="mt-2 text-center text-xs font-semibold text-[#81D8CF]">{notice}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => void saveCard()}
                disabled={busy !== null}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#81D8CF]/40 bg-[#81D8CF]/14 text-sm font-bold text-[#81D8CF] disabled:opacity-60"
              >
                {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}
                保存到相册
              </button>
              <button
                onClick={() => void sendCard()}
                disabled={busy !== null}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#81D8CF] text-sm font-bold !text-[#2f3333] disabled:opacity-60"
              >
                {busy === "share" ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                发给好友
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="dictionary-card rounded-3xl p-5 text-sm leading-relaxed text-white/68 shadow-xl sm:p-7">
        <h3 className="text-sm font-extrabold text-white/80">这个数是怎么算出来的（仅供参考）</h3>
        <ul className="mt-3 space-y-2">
          <li>· <b className="text-white/85">抽样外推</b>：N5–N1 每级抽十几道，各级答对率乘以该级词表规模再相加。所以它是<b className="text-white/85">当前 JLPT 词表范围内</b>的估计，不是「全日语词汇量」。</li>
          <li>· <b className="text-white/85">四选一，蒙也能蒙对</b>：所以每级得分按「答对 − 答错 ÷ 3」折算，<b className="text-white/85">答错会把这一级的分数往下压</b>，不是简单不计分。</li>
          <li>· <b className="text-white/85">不认识就点「不认识」</b>：它不扣分，也不算你蒙。真不会却硬猜，反而会同时拉低词汇量和可信度。</li>
          <li>· <b className="text-white/85">可信度</b> = 答题量（60）+ 没在赶进度（40），再<b className="text-white/85">乘以</b>「有多少作答其实是蒙的」的补数；越难的级别反而答得越好，每处再扣 8 分。所以全靠蒙的话，题答得再多可信度也接近 0。</li>
          <li>· <b className="text-white/85">超时按不认识记</b>，超时太多同样降可信度。切到别的页面会自动暂停，不算你超时。</li>
          <li>· 少于 15 题不给估计值：一个等级一题没答，区间会撑到整份词表那么宽，那个数是没意义的。</li>
          <li>· 测验<b className="text-white/85">完全独立</b>：不写复习流水、不改 FSRS、不影响今日计划。</li>
        </ul>
      </div>
    </div>
  );
};

const ResultView = ({ result, onRestart, onBack }: { result: VocabTestResult; onRestart: () => void; onBack: () => void }) => (
  <div className="mx-auto w-full max-w-3xl dictionary-card rounded-3xl p-5 shadow-xl sm:p-7">
    <div className="text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY SIZE</p>
      <h2 className="mt-2 text-2xl font-extrabold">
        {result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? "你的词汇量" : "答得还太少"}
      </h2>
      {result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? (
        <>
          {/* 摆点估计，不摆区间。区间退到底下那行小字 ——
              「3,860 – 6,402」这种宽度读不出任何东西，用户宁可要一个具体数字。 */}
          <p className="mt-4 text-4xl font-extrabold text-[#81D8CF] sm:text-5xl">
            约 {result.estimated.toLocaleString()} 词
          </p>
          <p className="mt-2 text-sm font-semibold text-white/58">
            在当前 JLPT 词表覆盖范围内 · 区间 {result.lower.toLocaleString()}–{result.upper.toLocaleString()}
          </p>
        </>
      ) : (
        <p className="mx-auto mt-4 max-w-md text-sm font-semibold leading-relaxed text-white/58">
          只答了 {result.answered} 题，还有等级一题没碰过，给不出有意义的区间。
          至少答满 {MIN_ANSWERS_FOR_ESTIMATE} 题（五个等级各三题左右）再看结果。
        </p>
      )}
    </div>
    <div className="mt-6 grid gap-2 sm:grid-cols-3">
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.answered}</b>
        <span className="text-xs text-white/52">已答题</span>
      </div>
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.confidence}%</b>
        <span className="text-xs text-white/52">结果可信度</span>
      </div>
      <div className="rounded-2xl bg-white/5 p-3 text-center">
        <b className="block text-xl">{result.answered >= MIN_ANSWERS_FOR_ESTIMATE ? result.recommendation : "—"}</b>
        <span className="text-xs text-white/52">建议从这里继续</span>
      </div>
    </div>
    <div className="mt-6">
      <h3 className="text-sm font-extrabold text-white/78">各级表现</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-5">
        {result.levels.map((level) => (
          <div key={level.level} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
            <b className="block">{level.level}</b>
            <span className="mt-1 block text-xs text-white/52">
              {level.rate == null ? "未答" : `${Math.round(level.rate * 100)}%`}
            </span>
            <span className="mt-1 block text-[11px] text-white/38">{level.answered} 题</span>
          </div>
        ))}
      </div>
    </div>
    <p className="mt-5 rounded-2xl border border-white/12 bg-white/5 p-3 text-xs leading-relaxed text-white/58">
      这是 JLPT 覆盖词表内的估计，不等于“全日语词汇量”。测验结果不会改变学习进度、复习流水或 FSRS。
    </p>
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onBack} className="focus-ring rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 hover:bg-white/[0.08]">返回</button>
      <button type="button" onClick={onRestart} className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-[#81D8CF] px-4 py-2.5 text-sm font-extrabold text-[#293333] hover:bg-[#A4E7E0]"><RotateCcw size={15} />重新测一次</button>
    </div>
  </div>
);

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

  if (view === "result" && result) {
    return <ResultView result={result} onRestart={() => begin(true)} onBack={() => setView("intro")} />;
  }

  if (view === "intro" || !session || !shownQuestion) {
    const resumable = Boolean(session && !session.finishedAt && session.responses.length > 0);
    return (
      <VocabTestHome
        history={history}
        latest={history[0] ?? null}
        resumable={resumable}
        resumeProgress={session ? `${session.responses.length} / ${session.plannedTotal}` : ""}
        resumeStartedAt={session?.startedAt ?? 0}
        resumeIdleMs={session ? Date.now() - (session.responses[session.responses.length - 1]?.answeredAt ?? session.startedAt) : 0}
        error={error}
        onResume={() => { setView("quiz"); setFeedback(null); }}
        onStart={() => begin(resumable)}
        onOpenResult={() => setView("result")}
        hasResult={Boolean(result) && (session?.responses.length ?? 0) > 0}
      />
    );
  }

  // ⚠️ 分母是 plannedTotal 不是 questions.length：摸底阶段只出好了 20 道，
  // 拿它当分母，进度条会在第 20 题冲到 100% 然后倒回去。
  const progress = Math.round((session.responses.length / session.plannedTotal) * 100);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/48">VOCABULARY CHECK</p>
          <h2 className="mt-1 text-xl font-extrabold">词汇量测验</h2>
        </div>
        <button type="button" onClick={stop} className="focus-ring rounded-2xl border border-white/15 px-3 py-2 text-xs font-bold text-white/60 hover:bg-white/[0.08]">结束并看结果</button>
      </div>
      <div className="mb-3 flex items-center gap-3 text-xs font-semibold text-white/55">
        <span className="min-w-0 flex-1">已答 {session.responses.length} / {session.plannedTotal}</span>
        <span className="inline-flex items-center gap-1"><Clock3 size={14} />{paused ? "已暂停" : `${remaining}s`}</span>
        {paused ? <Pause size={15} className="text-white/70" /> : <Play size={15} className="text-[#BFF4EE]" />}
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#81D8CF] transition-[width]" style={{ width: `${progress}%` }} /></div>
      <QuestionCard question={shownQuestion} disabled={Boolean(feedback) || paused} onChoose={choose} feedback={feedback ? { state: feedback.state, selected: feedback.selected } : null} />
      {paused && <p className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl vocab-fb-unknown border px-3 py-2 text-xs font-semibold"><Pause size={14} />切回此页面后会继续计时</p>}
      {feedback && (
        <div className={`mt-3 rounded-2xl border p-3 ${answerClass(feedback.state)}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-extrabold">{answerLabel(feedback.state)}</p>
            <span className="text-xs font-bold opacity-75">答案：{feedback.question.answer}</span>
          </div>
          <button type="button" onClick={nextQuestion} className="focus-ring mt-3 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/[0.08]">
            {atEnd ? "查看结果" : "下一题"}
          </button>
        </div>
      )}
    </div>
  );
}
