import { useEffect, useMemo, useState } from "react";
import { Brain, CalendarDays, CheckCircle2, ChevronRight, Clock3, Flame, History, Languages, ListChecks, Minus, Pencil, Plus, Puzzle, Repeat, Share2, Star, Volume2 } from "lucide-react";
import { AnalyticsDashboard } from "../../components/AnalyticsDashboard";
import { useFavoriteFolderPicker } from "../../components/FavoriteFolderPicker";
import { addFavorite, addFavorites, getStubbornGrammarToday, getStubbornWordsToday, type StubbornGrammarToday, type StubbornWordToday } from "../../lib/api";
import { ZooConfetti } from "../../components/ZooConfetti";
import { Sticker } from "../../components/CapybaraMascot";
import { MascotSay } from "../../components/MascotSay";
import { useCountUp } from "../../hooks/useCountUp";
import { JapaneseRuby } from "../../components/JapaneseRuby";
import { estimatedMinutesFor } from "../../lib/review-budget";
import { STUBBORN_DAILY_MISTAKES } from "../../lib/fsrs-scheduler";
import { studyDate as currentStudyDate } from "../../lib/database/db-utils";
import { splitFurigana, useFuriganaReady } from "../../lib/furigana";
import { lookupAccent, pitchPattern, splitMorae, usePitchAccentReady } from "../../lib/pitch-accent";
import { lookupTransitivity, useTransitivityReady } from "../../lib/transitivity";
import { saveImageToGallery, shareImage } from "../../lib/share-image";
import { getStudyPreferences } from "../../lib/studyPreferences";
import { playExample, prefetchExample } from "../../lib/speech";
import type { WordCard, WordStats } from "../../types/vocabulary";
import { ENCORE_DEFAULT_COLOR, encoreLimitedColor, MILESTONES, pickEncoreHook } from "./encore-style";
import { renderShareCard } from "./share-card";
import { ShareImageSheet } from "../../components/ShareImageSheet";
import {
  answerReadingText,
  concealedReadingParts,
  formatDuration,
  isLoanwordSourceCard,
  monthDays
} from "./word-study-utils";
import { preferredWordSurface } from "../../lib/orthography";
import { StubbornGrammarRow, StubbornHistorySheet, StubbornWordRow } from "./stubborn-history";
import { Paywall } from "../../components/Paywall";
import { canUseFeature } from "../../lib/entitlements";
import { useEntitlements } from "../../hooks/useEntitlements";
import { quizGroups } from "../../lib/distinction-quiz";

/** 自他标注。直接挂在词自己身上(不是只在配对面板里提),自/他 那个字放大加色,
 *  一眼扫得到 —— 中文「开」一个字通吃 開く/開ける,这一栏是最容易翻车的地方。 */
export const TransitivityBadge = ({ card }: { card: WordCard }) => {
  const ready = useTransitivityReady();
  const voice = ready ? lookupTransitivity(card.kanji, card.kana, card.pos) : null;
  if (!voice) return null;

  return (
    <span className="voice-badge">
      <span className="voice-badge-mark">{voice}</span>
      <span className="voice-badge-tail">动词</span>
    </span>
  );
};

const CIRCLED_DIGITS = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

/** 读音行,同时承担两件事:
 *  1. 按汉字把假名分组(初詣 → はつ もうで),否则中文母语者会默认按汉字个数对切;
 *  2. 逐拍画音高线 —— 橋(はし↓)和 箸(は↓し)假名一模一样,只有音高能分。
 *  两样数据都是异步加载的,没到位就退回朴素显示,不阻塞翻面。 */
export const ReadingLine = ({
  card,
  className,
  concealKanji = false,
  surface
}: {
  card: WordCard;
  className?: string;
  /** 汉字读音题揭晓前，只露出送り仮名/片假名，汉字对应读音不进入 DOM。 */
  concealKanji?: boolean;
  /** 汉字模式可传入标准化后的题面；经典模式默认使用自然主表记。 */
  surface?: string;
}) => {
  const furiganaReady = useFuriganaReady();
  const accentReady = usePitchAccentReady();
  const displaySurface = surface ?? preferredWordSurface(card);
  const reading = answerReadingText(card, displaySurface);
  if (!reading) return null;

  // 切不开的熟字训(明日=あした)当作一整段,音高线照样画。
  const segments = furiganaReady ? splitFurigana(displaySurface, reading) : null;
  const groups = segments ?? [{ text: reading, reading, isKanji: false }];

  if (concealKanji) {
    const parts = concealedReadingParts(segments);
    return (
      <p className={`${className ?? ""} inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1`}>
        {parts.map((part, index) => part.hidden ? (
          <span
            key={`hidden-${index}`}
            className="inline-block h-[0.72em] w-[1.45em] rounded-sm border border-[#81D8CF]/45 bg-[#81D8CF]/20 align-middle"
            aria-label="汉字读音已隐藏"
          />
        ) : (
          <span key={`${part.text}-${index}`} className="kana-group kana-group-kana">
            {part.text}
          </span>
        ))}
      </p>
    );
  }

  // 重音核按「第几拍」算,所以要按整词的拍序走,不能每段各算各的。
  const accent = accentReady ? lookupAccent(card.kanji, card.kana) : null;
  const pattern = accent === null ? null : pitchPattern(splitMorae(reading).length, accent);
  let moraIndex = 0;

  return (
    <p className={`${className ?? ""}${pattern ? " reading-has-pitch" : ""}`}>
      {groups.map((segment, index) => (
        <span
          key={`${segment.text}-${index}`}
          className={segment.isKanji ? "kana-group" : "kana-group kana-group-kana"}
        >
          {pattern
            ? splitMorae(segment.reading).map((mora, moraKey, morae) => {
                const pitch = pattern[moraIndex++];
                // 分组间隙由这一拍的右内边距产生,而不是下一组的外边距 —— 高音线
                // 是画在拍上的,用外边距会把线切断,看着像降调。
                const bridgesGap = moraKey === morae.length - 1 && index < groups.length - 1;
                return (
                  <span
                    key={`${mora}-${moraKey}`}
                    className={
                      `pitch-mora${pitch?.high ? " is-high" : ""}${pitch?.drop ? " is-drop" : ""}` +
                      (bridgesGap ? " has-gap" : "")
                    }
                  >
                    {mora}
                  </span>
                );
              })
            : segment.reading}
        </span>
      ))}
      {accent !== null && (
        <span className="pitch-badge" title={`音高重音 ${accent} 型`}>
          {CIRCLED_DIGITS[accent] ?? accent}
        </span>
      )}
    </p>
  );
};

export const KanjiAnswer = ({ card, surface }: { card: WordCard; surface?: string }) => {
  const displaySurface = surface ?? preferredWordSurface(card);
  if (isLoanwordSourceCard(card)) return <>{displaySurface}</>;

  const componentByChar = new Map((card.kanjiComponents ?? []).map((component) => [component.char, component]));

  return (
    <>
      {[...displaySurface].map((char, index) => {
        const component = componentByChar.get(char);
        const isVariant = Boolean(component?.marked);
        return (
          <span
            key={`${char}-${index}`}
            className={isVariant ? "kanji-variant-mark" : undefined}
            title={isVariant && component ? `${component.char} → ${component.simplified}` : undefined}
          >
            {char}
          </span>
        );
      })}
    </>
  );
};

/** 把例句里出现的原词形挑出来高亮,一眼能定位到这次学的词。
 *  动词/形容词在例句里多半是活用形(通っています ≠ 通う),匹配不上就原样返回,不硬凑。 */
const highlightHeadword = (sentence: string, card: WordCard) => {
  // 汉字形单字也高亮(味 → この料理は味が薄い);假名形必须≥2 字,否则 の/は 这类会满句乱标。
  const candidates = [card.kanji, card.kana.length > 1 ? card.kana : ""];
  const target = candidates.find((form) => form && sentence.includes(form));
  if (!target) return sentence;

  return sentence.split(target).flatMap((chunk, index) =>
    index === 0
      ? [chunk]
      : [
          <span key={`hit-${index}`} className="text-[#81D8CF]">{target}</span>,
          chunk
        ]
  );
};

/** 例句播放键:有预生成音频播文件,没有走系统语音。单词卡和语法卡共用。 */
export const ExamplePlayButton = ({ sentence }: { sentence: string }) => (
  <button
    type="button"
    aria-label="播放例句"
    className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
    onClick={(event) => {
      event.stopPropagation();
      void playExample(sentence, getStudyPreferences().voiceId);
    }}
  >
    <Volume2 size={16} aria-hidden="true" />
  </button>
);

/** 翻面后的例句框。词库里每个词都带 example_jp / example_meaning,
 *  React 重写时漏了这一块,单词卡一直没显示例句。 */
export const ExampleBlock = ({ card }: { card: WordCard }) => {
  const jp = card.example?.jp?.trim() ?? "";
  const meaning = card.example?.meaning?.trim() ?? "";
  // 翻面就预取:12 KB 一句,点播放时已经在缓存里
  useEffect(() => {
    if (jp) void prefetchExample(jp, getStudyPreferences().voiceId);
  }, [jp]);
  if (!jp && !meaning) return null;

  return (
    <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-white/15 bg-[#373b3b] p-4 text-left">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
        例句
        {jp && <ExamplePlayButton sentence={jp} />}
      </p>
      {jp && (
        <p className="jp mt-2 text-lg leading-8 text-white/88">
          {card.example.furigana ? (
            <JapaneseRuby text={jp} furigana={card.example.furigana} tokenBoundaries={card.example.tokens} />
          ) : highlightHeadword(jp, card)}
        </p>
      )}
      {meaning && <p className="mt-2 text-sm leading-6 text-white/65">{meaning}</p>}
    </div>
  );
};

/**
 * 今天的顽固词多到这个数，就不给加餐了。
 *
 * 加餐是「今天状态不错，再来一批」；而今天有三十个词跟你打了一架的时候，
 * 再塞新词进来只是把明天的账提前记上。这时候该做的是把这批词过一遍。
 */
const STUBBORN_ENCORE_BLOCK = 30;

interface FinishPanelProps {
  stats: WordStats | null;
  phase: string;
  localSeconds: number;
  onCheckIn?: () => void;
  onContinueStage2?: () => void;
  onContinueKanji?: () => void;
  onEncore?: (size?: number) => void;
  onStubbornQuickStudy?: (wordIds: number[]) => void;
  onOpenDistinctionQuiz?: () => void;
}

export const FinishPanel = ({ stats, phase, localSeconds, onCheckIn, onContinueStage2, onContinueKanji, onEncore, onStubbornQuickStudy, onOpenDistinctionQuiz }: FinishPanelProps) => {
  const { pickFolder, picker } = useFavoriteFolderPicker();
  const entitlements = useEntitlements();
  // 往日顽固词是 Pro：这一张 Paywall 由完成页自己弹，不用把 requirePro 从 App
  // 一路穿过 WordStudy 传进来（只为一个按钮加两层 props 不值当）。
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPaywall, setHistoryPaywall] = useState(false);
  const [stubborn, setStubborn] = useState<StubbornWordToday[]>([]);
  const [stubbornGrammar, setStubbornGrammar] = useState<StubbornGrammarToday[]>([]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [shareCard, setShareCard] = useState<{ url: string; blob: Blob } | null>(null);
  const [shareBusy, setShareBusy] = useState<"save" | "share" | null>(null);
  const [shareNotice, setShareNotice] = useState("");
  const studyDate = stats?.studyDate ?? currentStudyDate();
  const calendar = monthDays(studyDate);
  const checkins = new Set(stats?.checkins ?? []);
  const dailyStats = new Map((stats?.dailyStudyStats ?? []).map((item) => [item.date, item]));
  const totalSeconds = (stats?.wordStudySecondsToday ?? 0) + localSeconds;
  const todayStats = dailyStats.get(studyDate);
  const todayWordCount = todayStats?.wordCount ?? stats?.reviewedToday ?? 0;
  // 面板和日历上摆的是「减负 + 单词 + 语法」的合计,和小路同一口径;
  // 分享图和里程碑仍按单词算(那张图上写的是「词」,累计里程碑也是词的累计)。
  const todayTotal = todayStats?.total ?? todayWordCount;
  const distinctionGroupCount = useMemo(() => quizGroups({ kind: "today" }).length, []);
  const checkedToday = checkins.has(studyDate);
  const checkinDays = checkins.size;
  const isStage1Complete = phase === "stage1" && stats?.dailyPlanDone;
  const compactPhaseLabel = phase === "done" ? "全部完成"
    : phase === "stage1" ? "第一阶段"
      : phase === "mistakes" ? "错题本"
        : phase === "picked" ? "自选清单"
          : phase;
  const encore = stats?.encore;

  // 主题纸屑每个学习日只放一次:同一天反复回到完成页不再重放,免得变成噪音。
  // 记在 sessionStorage 而不是数据库 —— 这只是个视觉彩头,丢了也无所谓。
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (phase !== "done" && !isStage1Complete) return;
    const key = `mn-zoo-celebrated-${studyDate}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // 隐私模式下 sessionStorage 可能不可用,那就每次都放,不影响功能
    }
    setCelebrate(true);
  }, [phase, isStage1Complete, studyDate]);

  // 「继续学习」按钮的每日装扮与数量。默认数量由算法给:积压递减批或强度的一半。
  // 铅笔改的是**这一次加餐要学几个**,不是每日新词配额 —— 那个旋钮在设置页,
  // 而且积压未清时它对本次加餐根本不起作用,摆在这里就是个按了没反应的按钮。
  const [showSizePanel, setShowSizePanel] = useState(false);
  const [sizeOverride, setSizeOverride] = useState<number | null>(null);
  const limitedColor = encoreLimitedColor(studyDate);
  const encoreColor = limitedColor ?? ENCORE_DEFAULT_COLOR;
  const encoreInventory = encore ? encore.remaining + encore.unseenRemaining : 0;
  // 积压未清时数量跟积压走;清空后 = 每日新词配额的一半
  const dailyGoal = getStudyPreferences().dailyGoal;
  const recommendedSize = encore
    ? (encore.remaining > 0 ? encore.size : Math.min(Math.max(Math.round(dailyGoal / 2), 5), encore.unseenRemaining))
    : 0;
  const encoreHook = encore
    ? pickEncoreHook({
        studyDate,
        todayWordCount,
        weekEncoreCount: encore.weekEncoreCount,
        recommendedSize,
        totalLearned: encore.totalLearned
      })
    : null;
  // 上限 100 和 startEncore 里的钳制同一个数,别让滑杆能选出一个后端会悄悄改小的量。
  const encoreMax = Math.max(1, Math.min(encoreInventory, 100));
  const suggestedCount = Math.max(1, Math.min(encoreHook?.suggestedSize ?? recommendedSize, encoreMax));
  // override 存 null 表示「跟着推荐走」:库存/推荐随结算刷新时不会卡住一个过期的数。
  const encoreCount = Math.max(1, Math.min(sizeOverride ?? suggestedCount, encoreMax));
  const encoreMinutes = encore ? estimatedMinutesFor(encoreCount, encore.secondsPerWord) : 0;
  const sizePresets = Array.from(
    new Set([5, 10, 20].filter((value) => value < encoreMax).concat(encoreMax))
  );

  const applyEncoreSize = (value: number) => {
    setSizeOverride(Math.min(Math.max(Math.round(value), 1), encoreMax));
  };

  /**
   * 结算数字从 0 滚上来。这一页是**唯一**值得这么做的地方:数字在这里是一次性
   * 出现的大跳变(0 → 今天的成绩),滚的过程本身就是「我干掉了这些」。
   *
   * 刻意不给「用时」:那个数在这一页上还在实时走,delta 恒为 1 —— 滚起来不是动画,
   * 只是给每一次跳动加 320ms 的延迟。同理没给顶栏的松鼠小路(每答一题只 +1)。
   */
  const shownTotal = useCountUp(todayTotal);
  const shownCheckinDays = useCountUp(checkinDays);

  // 今天真正打过架的那几个词。进这一页才查一次:判据要数今天的流水,
  // 而这一页是今天最后一次结算,查早了数还没记全。
  useEffect(() => {
    setStubborn(getStubbornWordsToday());
    // 混合模式里语法和单词是同一场，只列单词等于说了一半。没答过语法的日子这里是空的，
    // 所以经典模式下这一段自己就不出现，不用按模式加闸。
    setStubbornGrammar(getStubbornGrammarToday());
  }, [studyDate, todayWordCount]);

  const unfavoritedStubborn = stubborn.filter((word) => !word.isFavorite);
  const stubbornTitle = stubborn.length
    ? `今天的顽固词 ${stubborn.length} 个${stubbornGrammar.length ? ` · 语法 ${stubbornGrammar.length} 条` : ""}`
    : `今天的顽固语法 ${stubbornGrammar.length} 条`;
  // 顽固词多到一定程度就不给加餐，改成「把这批词过一遍」。
  const stubbornOverload = stubborn.length >= STUBBORN_ENCORE_BLOCK && Boolean(onStubbornQuickStudy);
  const showEncore = phase === "done" && Boolean(encore?.available) && Boolean(onEncore) && !stubbornOverload;
  const favoriteStubborn = (words: StubbornWordToday[], title: string) => {
    if (!words.length) return;
    pickFolder({
      title,
      onPick: (folder) => {
        addFavorites("word", words.map((word) => word.id), folder);
        setStubborn((current) => current.map((word) => (
          words.some((picked) => picked.id === word.id) ? { ...word, isFavorite: true } : word
        )));
      }
    });
  };
  const toggleStubbornFavorite = (word: StubbornWordToday) => {
    if (word.isFavorite) return;
    pickFolder({
      title: `收藏「${preferredWordSurface(word)}」到`,
      onPick: (folder) => {
        addFavorite("word", word.id, folder);
        setStubborn((current) => current.map((item) => (
          item.id === word.id ? { ...item, isFavorite: true } : item
        )));
      }
    });
  };

  const shareFileName = `shushugo-${studyDate}.png`;

  const generateShareImage = async () => {
    // 今天是否冲破了某个累计里程碑(今天学之前 < 里程碑 ≤ 现在)
    const totalLearned = encore?.totalLearned ?? 0;
    const milestoneReached = MILESTONES.find(
      (m) => totalLearned >= m && totalLearned - todayWordCount < m
    ) ?? 0;
    const blob = await renderShareCard({
      studyDate,
      todayWordCount,
      totalSeconds,
      checkins,
      encoreWords: encore?.todayEncoreWords ?? 0,
      milestoneReached
    });
    if (shareCard) URL.revokeObjectURL(shareCard.url);
    setShareNotice("");
    setShareCard({ url: URL.createObjectURL(blob), blob });
  };

  const handleSaveImage = async () => {
    if (!shareCard || shareBusy) return;
    setShareBusy("save");
    setShareNotice("");
    try {
      const result = await saveImageToGallery(shareCard.blob, shareFileName);
      setShareNotice(result === "gallery" ? "已保存到相册 ✓" : "已开始下载 ✓");
    } catch {
      setShareNotice("保存失败,请在 设置 > 收集日里允许访问相册后重试");
    } finally {
      setShareBusy(null);
    }
  };

  const handleShareImage = async () => {
    if (!shareCard || shareBusy) return;
    setShareBusy("share");
    setShareNotice("");
    try {
      const result = await shareImage(shareCard.blob, shareFileName, "今日单词完成");
      if (result === "unsupported") setShareNotice("当前浏览器不支持直接分享,请先保存图片");
    } catch {
      setShareNotice("分享失败,请重试");
    } finally {
      setShareBusy(null);
    }
  };

  const closeShareImage = () => {
    if (shareCard) URL.revokeObjectURL(shareCard.url);
    setShareCard(null);
    setShareNotice("");
  };

  return (
    <>
      {celebrate && <ZooConfetti />}
      <div className="fin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="fin-page mx-auto flex min-h-full w-full max-w-2xl flex-col">
          {/* 标题只说一次：原来右上还挂一枚「全部完成」，和「今日单词完成」是同一句话。
              阶段胶囊只在它真有别的信息时才出现（第一阶段 / 错题本 / 自选清单）。 */}
          <header className="fin-hero">
            <Sticker name="mood-cheer" size={68} className="shrink-0" />
            <div className="min-w-0 flex-1">
              {/* 自选清单不是今日计划：它勾的词可能一个都没到期，写「今日单词完成」是假的 */}
              <h2 className="fin-title">{phase === "picked" ? "这批词过完了" : "今日单词完成"}</h2>
              <p className="fin-sub">
                学习日 {Number(studyDate.slice(5, 7))}/{Number(studyDate.slice(8))}
                {phase !== "done" && <span className="ds-pill ds-pill-primary">{compactPhaseLabel}</span>}
              </p>
            </div>
          </header>

          {/* 三个数一条带子。今天学了多少是这一页的主角，排第一 */}
          <div className="fin-stats">
            <div><b>{shownTotal}<small>项</small></b><span><CalendarDays size={13} aria-hidden="true" />今天学了</span></div>
            {/* 单位缩小一号：「5小时42分」按 22px 排，三等分的一格放不下，会被截成「5小时4…」 */}
            <div><b>{formatDuration(totalSeconds).split(/(\d+)/).filter(Boolean).map((part, i) => (/^\d+$/.test(part) ? part : <small key={i}>{part}</small>))}</b><span><Clock3 size={13} aria-hidden="true" />用时</span></div>
            <div><b>{shownCheckinDays}<small>天</small></b><span><CheckCircle2 size={13} aria-hidden="true" />累计打卡</span></div>
          </div>

          <section className="fin-block">
            <div className="fin-cal-head">
              <p className="fin-block-title">{calendar.title}</p>
              <button
                onClick={onCheckIn}
                disabled={checkedToday || !onCheckIn}
                className={`focus-ring fin-checkin${checkedToday ? " is-done" : ""}`}
              >
                <CheckCircle2 size={15} />
                {checkedToday ? "已打卡" : "打卡"}
              </button>
            </div>
            <div className="fin-cal">
              {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
                <span key={label} className="fin-cal-wd">{label}</span>
              ))}
              {calendar.cells.map((cell, index) => {
                if (!cell) return <span key={`empty-${index}`} />;
                const checked = checkins.has(cell.date);
                const isToday = cell.date === studyDate;
                const dayStats = dailyStats.get(cell.date);
                const daySeconds = (dayStats?.seconds ?? 0) + (isToday ? localSeconds : 0);
                const total = dayStats?.total ?? 0;
                const hasActivity = checked || daySeconds > 0 || total > 0;
                const breakdown = dayStats
                  ? [`单词 ${dayStats.wordCount}`, dayStats.grammarCount ? `语法 ${dayStats.grammarCount}` : "", dayStats.reliefCount ? `减负 ${dayStats.reliefCount}` : ""].filter(Boolean).join(" · ")
                  : "";
                return (
                  <span
                    key={cell.date}
                    className="group relative grid place-items-center"
                    tabIndex={0}
                    aria-label={`${cell.date}，学习时间 ${formatDuration(daySeconds)}，学习 ${total} 项${breakdown ? `（${breakdown}）` : ""}`}
                  >
                    <span className={`fin-day${checked ? " is-checked" : hasActivity ? " is-active" : ""}${isToday ? " is-today" : ""}`}>
                      {cell.day}
                    </span>
                    <span className="study-calendar-tooltip pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-44 -translate-x-1/2 rounded-2xl p-3 text-left group-hover:block group-focus:block">
                      <span className="block text-xs font-bold">{cell.date}</span>
                      <span className="mt-2 block text-xs">学习时间：{formatDuration(daySeconds)}</span>
                      <span className="mt-1 block text-xs">学习：{total} 项</span>
                      {breakdown && <span className="mt-0.5 block text-[11px] opacity-70">{breakdown}</span>}
                      <span className="mt-1 block text-xs opacity-70">{checked ? "已打卡" : "未打卡"}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          </section>

          {stubbornOverload && (
            <section className="fin-block">
              <MascotSay sticker="mood-puzzled" tone="warn" size={52}>
                今天有 <b>{stubborn.length}</b> 个词跟你打了一架。这种时候再加一批新词，只是把明天的账提前记上。
              </MascotSay>
              <button
                onClick={() => onStubbornQuickStudy?.(stubborn.map((word) => word.id))}
                className="focus-ring ds-btn mt-3 w-full"
              >
                <Flame size={18} />
                快速复习这 {stubborn.length} 个顽固词
              </button>
              <p className="fin-note">一页一页过，只挑没记住的</p>
            </section>
          )}

          {showEncore && encore && (
            <section className="fin-block">
              {encore.fatigued ? (
                <>
                  <MascotSay sticker="mood-sleep" size={52}>正确率在往下掉了。剩下的明天清，更高效。</MascotSay>
                  <button onClick={() => onEncore?.(encoreCount)} className="focus-ring ds-btn-soft mt-3 w-full">
                    仍要再来 {encoreCount} 个 · 约 {encoreMinutes} 分钟
                  </button>
                </>
              ) : (
                <>
                  <div className="fin-encore-lead">
                    <p className="min-w-0 truncate">{encoreHook?.lead}</p>
                    {limitedColor && (
                      <span className="fin-limited" style={{ color: limitedColor.hex, borderColor: `${limitedColor.hex}59` }}>
                        {limitedColor.weekdayJp}・{limitedColor.colorName}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {/* 限定色是加餐这件事自己的彩头（每天一色），不跟皮肤走，所以这里的底色是内联的 */}
                    <button
                      onClick={() => onEncore?.(encoreCount)}
                      className="encore-cta focus-ring fin-encore-btn"
                      style={{ backgroundColor: encoreColor.hex, color: encoreColor.ink }}
                    >
                      继续学习 {encoreCount} 个 · 约 {encoreMinutes} 分钟
                      <span className="encore-shine" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setShowSizePanel((value) => !value)}
                      aria-label="调整本次加餐数量"
                      aria-expanded={showSizePanel}
                      className="focus-ring fin-encore-edit"
                    >
                      <Pencil size={18} />
                    </button>
                  </div>
                  {showSizePanel && (
                    <div className="fin-size">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-bold">本次加餐 · {encoreCount} 个</p>
                        <span className="inline-flex items-center gap-1.5">
                          <button onClick={() => applyEncoreSize(encoreCount - 1)} aria-label="本次减 1 个" className="focus-ring fin-round">
                            <Minus size={14} />
                          </button>
                          <button onClick={() => applyEncoreSize(encoreCount + 1)} aria-label="本次加 1 个" className="focus-ring fin-round">
                            <Plus size={14} />
                          </button>
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={encoreMax}
                        step={1}
                        value={encoreCount}
                        onChange={(event) => applyEncoreSize(Number(event.target.value))}
                        aria-label="本次加餐数量"
                        className="w-full"
                        style={{ accentColor: encoreColor.hex }}
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setSizeOverride(null)}
                          aria-pressed={sizeOverride === null}
                          className="focus-ring ds-chip"
                        >
                          推荐 {suggestedCount}
                        </button>
                        {sizePresets.map((value) => (
                          <button
                            key={value}
                            onClick={() => applyEncoreSize(value)}
                            aria-pressed={sizeOverride === value}
                            className="focus-ring ds-chip"
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="fin-note">
                    {encore.remaining > 0
                      ? `待清积压还剩 ${encore.remaining} 个，优先复习`
                      : `积压已清空，这批是新词 · 库存 ${encore.unseenRemaining} 个`}
                  </p>
                </>
              )}
            </section>
          )}

          {stubborn.length === 0 && stubbornGrammar.length === 0 && (
            <button
              onClick={() => (canUseFeature("stubbornHistory", entitlements) ? setHistoryOpen(true) : setHistoryPaywall(true))}
              className="focus-ring fin-block fin-row"
            >
              <History size={16} className="shrink-0 text-[#E8971C]" />
              <span className="min-w-0 flex-1">今天没有顽固词<small className="fin-row-sub">翻翻往日跟你打过架的词</small></span>
              <ChevronRight size={16} className="shrink-0 opacity-50" />
            </button>
          )}
          {(stubborn.length > 0 || stubbornGrammar.length > 0) && (
            <section className="fin-block">
              <div className="mb-2 flex items-center gap-2">
                <Flame size={16} className="shrink-0 text-[#E8971C]" />
                <p className="fin-block-title min-w-0 flex-1 truncate">{stubbornTitle}</p>
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => (canUseFeature("stubbornHistory", entitlements) ? setHistoryOpen(true) : setHistoryPaywall(true))}
                  className="focus-ring ds-chip fin-chip"
                >
                  <History size={13} />
                  往日
                </button>
                {/* 快速复习不等到「顽固词多到换掉加餐」才给入口：列表就在眼前，
                    想现在过一遍是最自然的下一步。超过阈值时上面那块会把加餐整个换掉。 */}
                {!stubbornOverload && onStubbornQuickStudy && (
                  <button
                    onClick={() => onStubbornQuickStudy(stubborn.map((word) => word.id))}
                    className="focus-ring ds-chip fin-chip"
                  >
                    <ListChecks size={13} />
                    快速复习
                  </button>
                )}
                {unfavoritedStubborn.length > 0 && (
                  <button
                    onClick={() => favoriteStubborn(unfavoritedStubborn, `把今天 ${unfavoritedStubborn.length} 个顽固词收进`)}
                    className="focus-ring ds-chip fin-chip"
                  >
                    <Star size={13} />
                    全部收藏
                  </button>
                )}
              </div>
              <div className="fin-list max-h-56 overflow-y-auto">
                {stubborn.map((word) => (
                  <StubbornWordRow key={word.id} word={word} onFavorite={toggleStubbornFavorite} />
                ))}
                {/* 语法用的是同一条判据（累计忘 > 8 次且今天错 ≥ 3 次）。
                    ⚠️ 没有收藏按钮：语法收藏存的是 grammar.ts 的字符串 id，这里只有
                    grammar_points 的数字 id，桥接得按 pattern 去翻那份 1.2MB 的语法数据。
                    想收藏去语法列表页点，那里本来就有一颗星。 */}
                {stubbornGrammar.map((point) => (
                  <StubbornGrammarRow key={`g-${point.id}`} point={point} />
                ))}
              </div>
              <p className="fin-note">
                一共忘过 8 次以上、今天又错了 {STUBBORN_DAILY_MISTAKES} 次的词。集中攻坚走错题本模式；
                语法同一条判据，收藏和攻坚在语法列表页。
              </p>
            </section>
          )}

          {distinctionGroupCount > 0 && onOpenDistinctionQuiz && (
            <section className="fin-block fin-row">
              <Puzzle size={16} className="shrink-0 text-[var(--ds-primary-ink)]" />
              <p className="fin-block-title min-w-0 flex-1">今天碰到的易混组 {distinctionGroupCount} 组</p>
              <button type="button" onClick={onOpenDistinctionQuiz} className="focus-ring ds-btn fin-small-btn">
                练一练
              </button>
            </section>
          )}

          <div className="fin-tiles">
            {isStage1Complete && (
              <>
                <button
                  onClick={onContinueStage2}
                  disabled={!onContinueStage2 || !stats?.stage2Total || stats.stage2Completed >= stats.stage2Total}
                  className="focus-ring fin-tile"
                >
                  <Repeat size={18} />
                  <b>反向学习</b>
                  <span>出日语，回忆释义 {stats?.stage2Completed ?? 0}/{stats?.stage2Total ?? 0}</span>
                </button>
                <button
                  onClick={onContinueKanji}
                  disabled={!onContinueKanji || Boolean(stats?.kanjiTotal && stats.kanjiCompleted >= stats.kanjiTotal)}
                  className="focus-ring fin-tile"
                >
                  <Languages size={18} />
                  <b>汉字读音</b>
                  <span>{stats?.kanjiTotal ? `看表记，回忆读音 ${stats.kanjiCompleted}/${stats.kanjiTotal}` : "生成今日汉字读音队列后开始"}</span>
                </button>
              </>
            )}
            <button onClick={() => setShowAnalytics(true)} className="focus-ring fin-tile">
              <Brain size={18} />
              <b>记忆程度</b>
              <span>基于实际复习数据</span>
            </button>
            <button onClick={() => void generateShareImage()} className="focus-ring fin-tile">
              <Share2 size={18} />
              <b>生成炫耀图</b>
              <span>数量、用时、打卡</span>
            </button>
          </div>

          {/* 这一页是今天最后一眼，道个别。原来是一枚贴纸 + 一个窄气泡 + 每日一句贴纸挤一行，
              手机上气泡被挤成一行四个字；每日一句那张图上的字直接写进气泡里 */}
          <MascotSay sticker="empty-bye" size={64} className="fin-bye">
            再见～明天也要加油！<br />每天收集一点点，未来会不一样。
          </MascotSay>
        </div>
      </div>

      {shareCard && (
        <ShareImageSheet
          title="今日炫耀图"
          url={shareCard.url}
          alt="今日单词完成分享图"
          notice={shareNotice}
          busy={shareBusy}
          onSave={() => void handleSaveImage()}
          onShare={() => void handleShareImage()}
          onClose={closeShareImage}
        />
      )}

      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
      {historyOpen && (
        <StubbornHistorySheet
          onQuickStudy={onStubbornQuickStudy && ((ids) => { setHistoryOpen(false); onStubbornQuickStudy(ids); })}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {historyPaywall && (
        <Paywall
          feature="stubbornHistory"
          onClose={() => setHistoryPaywall(false)}
          onUnlocked={() => { setHistoryPaywall(false); setHistoryOpen(true); }}
        />
      )}
      {picker}
    </>
  );
};
