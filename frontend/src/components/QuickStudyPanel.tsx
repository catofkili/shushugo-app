import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Eye, ListChecks, NotebookPen, Send } from "lucide-react";
import { getQuickStudySession, getQuickStudySessionForWords, submitQuickStudyBatch } from "../lib/api";
import { clearQuickStudyDraft, loadQuickStudyDraft, saveQuickStudyDraft } from "../lib/quick-study-draft";
import { studyDate } from "../lib/database/db-utils";
import { answerOptions, primaryAnswerText, secondaryAnswerText } from "../features/word-study/word-study-utils";
import type { Page } from "../types/app";
import type { WordAnswer, WordCard } from "../types/vocabulary";
import { yieldToPaint } from "../lib/yield-to-paint";
import { useRowSelection } from "../hooks/useRowSelection";

type Props = {
  onNavigate: (page: Page) => void;
  variant?: "entry" | "page";
  onDailyModeComplete?: () => void;
  /**
   * 指定一批词过一遍（完成页的「快速复习今天的顽固词」）。
   * 这一趟**不碰草稿**：草稿是「今天那份快速学习做到哪了」，
   * 拿一次性的名单去覆盖它，用户回到快速学习会发现自己排了一半的那页没了。
   */
  wordIds?: number[];
  heading?: string;
};

type SubmitSummary = {
  total: number;
  counts: Record<WordAnswer, number>;
};

const QUICK_STUDY_PAGE_SIZE = 50;
const QUICK_STUDY_PREFETCH_SIZE = QUICK_STUDY_PAGE_SIZE * 2;
// v1 改为确定性的优先级顺序。恢复旧草稿时只迁移顺序，不丢评级/答案状态。
const QUICK_STUDY_ORDER_VERSION = 1;

/** 快速学习默认判为「认识」，用户只需要把不认识或模糊的词改掉。 */
const DEFAULT_QUICK_RATING: WordAnswer = "know";
const defaultRatingOption = answerOptions.find((option) => option.value === DEFAULT_QUICK_RATING)
  ?? answerOptions[1];

const initialRatings = (cards: WordCard[]) => Object.fromEntries(
  cards.map((card) => [card.id, DEFAULT_QUICK_RATING])
) as Record<number, WordAnswer>;

const phaseLabel = (phase: string) => {
  if (phase === "stage2") return "反向复习";
  if (phase === "kanji") return "汉字读音";
  return "今日词汇";
};

export function QuickStudyPanel({ onNavigate, variant = "page", onDailyModeComplete, wordIds, heading }: Props) {
  const batchMode = Boolean(wordIds?.length);
  const [cards, setCards] = useState<WordCard[]>([]);
  const [nextCards, setNextCards] = useState<WordCard[]>([]);
  const [seenWordIds, setSeenWordIds] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState("stage1");
  const [ratings, setRatings] = useState<Record<number, WordAnswer>>({});
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [ratingOpenId, setRatingOpenId] = useState<number | null>(null);
  const [ratingPlacement, setRatingPlacement] = useState<"up" | "down">("up");
  const [loading, setLoading] = useState(true);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [submitSummary, setSubmitSummary] = useState<SubmitSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 长按进选择模式 + 拖动划选：这一套和词库的选词共用 hooks/useRowSelection，
  // 别在这儿再写一遍（手势那几个阈值每写一遍都要重踩一次坑）。
  const selection = useRowSelection({
    rowSelector: ".quick-study-row[data-quick-word-id]",
    idKey: "quickWordId",
    onEnter: () => setRatingOpenId(null),
    onExit: () => setRatingOpenId(null)
  });
  const { selectionMode, selectedIds, exit: exitSelection, restore: restoreSelection } = selection;

  const submittingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const ratingGesturePointerRef = useRef<number | null>(null);
  // 打开这一轮时固定学习日。即使页面跨过凌晨 4 点，也不在用户正在评卡时强制换页；
  // 旧日期草稿在下次进入快速学习时会被丢弃。
  const draftStudyDateRef = useRef(studyDate());
  const batchWordIdsRef = useRef<number[]>(wordIds ?? []);
  batchWordIdsRef.current = wordIds ?? [];

  const load = useCallback(async (restoreDraft = false) => {
    setLoading(true);
    setError("");
    try {
      // 先让页面把标题和首屏容器画出来,再做同步词库查询。
      await yieldToPaint();
      if (batchWordIdsRef.current.length) {
        const data = getQuickStudySessionForWords(batchWordIdsRef.current);
        setCards(data.cards.slice(0, QUICK_STUDY_PAGE_SIZE));
        setNextCards(data.cards.slice(QUICK_STUDY_PAGE_SIZE));
        setSeenWordIds(new Set(data.cards.map((card) => card.id)));
        setPhase(data.phase);
        setRatings(initialRatings(data.cards.slice(0, QUICK_STUDY_PAGE_SIZE)));
        setRevealedIds(new Set());
        setRatingOpenId(null);
        exitSelection();
        return;
      }
      if (restoreDraft) {
        const draft = await loadQuickStudyDraft();
        if (draft) {
          draftStudyDateRef.current = draft.studyDate;
          let orderedDraft = draft;
          if ((draft.orderVersion ?? 0) < QUICK_STUDY_ORDER_VERSION) {
            try {
              const draftCardCount = draft.cards.length;
              const draftCards = [...draft.cards, ...draft.nextCards];
              const freshOrder = getQuickStudySession(draftCards.length);
              if (freshOrder.phase === draft.phase && freshOrder.cards.length) {
                const rank = new Map(freshOrder.cards.map((card, index) => [card.id, index]));
                const reordered = [...draftCards].sort((left, right) => (
                  (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
                  - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
                ));
                orderedDraft = {
                  ...draft,
                  cards: reordered.slice(0, draftCardCount),
                  nextCards: reordered.slice(draftCardCount),
                  orderVersion: QUICK_STUDY_ORDER_VERSION
                };
              }
            } catch (migrationError) {
              console.warn("[quick-study] 旧草稿顺序迁移跳过", migrationError);
            }
          }
          const seenIds = new Set(orderedDraft.seenWordIds);
          let prefetchedNext = orderedDraft.nextCards;
          if (!prefetchedNext.length) {
            const nextData = getQuickStudySession(QUICK_STUDY_PAGE_SIZE, [...seenIds]);
            if (nextData.phase === orderedDraft.phase) {
              prefetchedNext = nextData.cards;
              prefetchedNext.forEach((card) => seenIds.add(card.id));
            }
          }
          setCards(orderedDraft.cards);
          setNextCards(prefetchedNext);
          setSeenWordIds(seenIds);
          setPhase(orderedDraft.phase);
          setRatings(orderedDraft.ratings);
          setRevealedIds(new Set(orderedDraft.revealedIds));
          setRatingOpenId(null);
          setPageNumber(orderedDraft.pageNumber);
          restoreSelection(orderedDraft.selectionMode, orderedDraft.selectedIds);
          return;
        }
      }
      draftStudyDateRef.current = studyDate();
      const data = getQuickStudySession(QUICK_STUDY_PREFETCH_SIZE);
      const currentPage = data.cards.slice(0, QUICK_STUDY_PAGE_SIZE);
      const nextPage = data.cards.slice(QUICK_STUDY_PAGE_SIZE);
      setCards(currentPage);
      setNextCards(nextPage);
      setSeenWordIds(new Set(data.cards.map((card) => card.id)));
      setPhase(data.phase);
      setRatings(initialRatings(currentPage));
      setRevealedIds(new Set());
      setRatingOpenId(null);
      exitSelection();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "暂时无法读取快速学习内容");
    } finally {
      setLoading(false);
    }
  }, [exitSelection, restoreSelection]);

  useEffect(() => {
    if (variant === "entry") return;
    let cancelled = false;
    const hydrate = async () => {
      await Promise.resolve();
      await load(true);
      if (!cancelled) setDraftHydrated(true);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [load, variant]);

  useLayoutEffect(() => {
    if (variant === "entry" || batchMode || !draftHydrated || loading || submitting || !cards.length) return;
    void saveQuickStudyDraft({
      studyDate: draftStudyDateRef.current,
      orderVersion: QUICK_STUDY_ORDER_VERSION,
      cards,
      nextCards,
      seenWordIds: [...seenWordIds],
      phase,
      ratings,
      revealedIds: [...revealedIds],
      pageNumber,
      selectionMode,
      selectedIds: [...selectedIds]
    });
  }, [batchMode, cards, draftHydrated, loading, nextCards, pageNumber, phase, ratings, revealedIds, seenWordIds, selectedIds, selectionMode, submitting, variant]);

  /** batch 模式（指定名单）不写草稿：那份草稿属于「今天的快速学习」。 */
  const persistDraft = (payload: Parameters<typeof saveQuickStudyDraft>[0]) => (
    batchMode ? Promise.resolve() : saveQuickStudyDraft(payload)
  );

  const toggleAnswer = (wordId: number) => {
    setRevealedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>, wordId: number) => {
    if (selection.consumedByGesture()) return;
    // 行内已有按钮保留各自行为，不能因为事件冒泡又翻一次答案。
    if ((event.target as HTMLElement).closest("button")) return;
    if (selectionMode) {
      selection.toggle(wordId);
      return;
    }
    toggleAnswer(wordId);
  };

  const exitSelectionMode = () => selection.exit();

  const applySelectionRating = useCallback((answer: WordAnswer) => {
    if (!selectedIds.size) return;
    setRatings((current) => {
      const next = { ...current };
      selectedIds.forEach((wordId: number) => { next[wordId] = answer; });
      return next;
    });
    setRatingOpenId(null);
  }, [selectedIds]);

  const applyRatingAtPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const button = element?.closest<HTMLElement>("[data-batch-rating]");
    const value = button?.dataset.batchRating as WordAnswer | undefined;
    if (value && answerOptions.some((option) => option.value === value)) applySelectionRating(value);
  }, [applySelectionRating]);

  const startRatingGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    ratingGesturePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyRatingAtPoint(event.clientX, event.clientY);
  };

  const moveRatingGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (ratingGesturePointerRef.current === event.pointerId) applyRatingAtPoint(event.clientX, event.clientY);
  };

  const endRatingGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (ratingGesturePointerRef.current === event.pointerId) ratingGesturePointerRef.current = null;
  };

  const toggleAllAnswers = () => {
    const shouldReveal = !allRevealed;
    setRevealedIds(shouldReveal ? new Set(cards.map((card) => card.id)) : new Set());
  };

  const selectRating = (wordId: number, answer: WordAnswer) => {
    setRatings((current) => ({ ...current, [wordId]: answer }));
    setRatingOpenId(null);
  };

  const toggleRating = (event: ReactMouseEvent<HTMLButtonElement>, wordId: number) => {
    if (ratingOpenId === wordId) {
      setRatingOpenId(null);
      return;
    }
    // 菜单默认向上弹；如果上方会撞到 sticky 标题栏，就改为向下展开，
    // 保证最上面的词也能点到“忘记/模糊”。预留四项菜单的真实高度余量。
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const headerRect = panelRef.current?.querySelector<HTMLElement>(".quick-study-head")?.getBoundingClientRect();
    const menuHeight = 176;
    const safeTop = (headerRect?.bottom ?? 0) + 6;
    setRatingPlacement(buttonRect.top - menuHeight < safeTop ? "down" : "up");
    setRatingOpenId(wordId);
  };

  const prepareSubmit = () => {
    if (!cards.length || submittingRef.current) return;
    setError("");
    const counts = answerOptions.reduce<Record<WordAnswer, number>>((result, option) => {
      result[option.value] = 0;
      return result;
    }, {} as Record<WordAnswer, number>);
    cards.forEach((card) => {
      const answer = ratings[card.id] ?? DEFAULT_QUICK_RATING;
      counts[answer] += 1;
    });
    setSubmitSummary({ total: cards.length, counts });
  };

  const confirmSubmit = async () => {
    if (!submitSummary || !cards.length || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      submitQuickStudyBatch(
        cards.map((card) => ({ wordId: card.id, answer: ratings[card.id] ?? DEFAULT_QUICK_RATING })),
        phase
      );

      setSubmitSummary(null);
      const nextPageNumber = pageNumber + 1;

      if (nextCards.length) {
        // 下一页在提交前就已经固定：先立刻切页，再准备下下页。
        const nextPage = nextCards;
        const nextRatings = initialRatings(nextPage);
        const nextSeenIds = new Set(seenWordIds);
        const saveReadyPage = persistDraft({
          studyDate: draftStudyDateRef.current,
          orderVersion: QUICK_STUDY_ORDER_VERSION,
          cards: nextPage,
          nextCards: [],
          seenWordIds: [...nextSeenIds],
          phase,
          ratings: nextRatings,
          revealedIds: [],
          pageNumber: nextPageNumber,
          selectionMode: false,
          selectedIds: []
        });
        setCards(nextPage);
        setNextCards([]);
        setSeenWordIds(nextSeenIds);
        setRatings(nextRatings);
        setRevealedIds(new Set());
        setRatingOpenId(null);
        setPageNumber(nextPageNumber);
        selection.exit();
        panelRef.current?.scrollIntoView({ block: "start" });

        await yieldToPaint();
        const followingData = batchMode
          ? { cards: [] as WordCard[], phase }
          : getQuickStudySession(QUICK_STUDY_PAGE_SIZE, [...nextSeenIds]);
        if (followingData.phase === phase && followingData.cards.length) {
          const followingPage = followingData.cards;
          followingPage.forEach((card) => nextSeenIds.add(card.id));
          setNextCards(followingPage);
          setSeenWordIds(new Set(nextSeenIds));
          await persistDraft({
            studyDate: draftStudyDateRef.current,
            orderVersion: QUICK_STUDY_ORDER_VERSION,
            cards: nextPage,
            nextCards: followingPage,
            seenWordIds: [...nextSeenIds],
            phase,
            ratings: nextRatings,
            revealedIds: [],
            pageNumber: nextPageNumber,
            selectionMode: false,
            selectedIds: []
          });
        } else {
          await saveReadyPage;
        }
        return;
      }

      // 本轮所有不同词都已出现过。当前末页提交后才开启错误词/下一阶段的新一轮。
      // 指定名单过完就结束，不接着把今天剩下的词拉进来 —— 用户点的是
      // 「快速复习今天的顽固词」，不是「开始一轮快速学习」。
      const nextPass = batchMode
        ? { cards: [] as WordCard[], phase }
        : getQuickStudySession(QUICK_STUDY_PREFETCH_SIZE);
      const nextPage = nextPass.cards.slice(0, QUICK_STUDY_PAGE_SIZE);
      const followingPage = nextPass.cards.slice(QUICK_STUDY_PAGE_SIZE);
      const nextPhase = nextPass.phase;
      const nextSeenIds = new Set(nextPass.cards.map((card) => card.id));

      if (!nextPage.length) {
        if (!batchMode) await clearQuickStudyDraft();
        setCards([]);
        setNextCards([]);
        setSeenWordIds(new Set());
        setRatings({});
        setRevealedIds(new Set());
        selection.exit();
        onDailyModeComplete?.();
        return;
      }

      const nextRatings = initialRatings(nextPage);
      const saveNextPage = persistDraft({
        studyDate: draftStudyDateRef.current,
        orderVersion: QUICK_STUDY_ORDER_VERSION,
        cards: nextPage,
        nextCards: followingPage,
        seenWordIds: [...nextSeenIds],
        phase: nextPhase,
        ratings: nextRatings,
        revealedIds: [],
        pageNumber: nextPageNumber,
        selectionMode: false,
        selectedIds: []
      });
      setCards(nextPage);
      setNextCards(followingPage);
      setSeenWordIds(nextSeenIds);
      setPhase(nextPhase);
      setRatings(nextRatings);
      setRevealedIds(new Set());
      setRatingOpenId(null);
      setPageNumber(nextPageNumber);
      selection.exit();
      panelRef.current?.scrollIntoView({ block: "start" });
      await saveNextPage;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败，请稍后再试");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const allRevealed = cards.length > 0 && revealedIds.size === cards.length;

  if (variant === "entry") {
    return (
      <button className="zoo-tile zoo-tile-hero zoo-tile-quick" onClick={() => onNavigate("quick-study")}>
        <span className="zoo-tile-quick-emoji" aria-hidden="true"><NotebookPen size={20} /></span>
        <b className="zoo-tile-quick-title">快速复习</b>
        <span className="zoo-tile-quick-arrow" aria-hidden="true">→</span>
      </button>
    );
  }

  return (
    <section ref={panelRef} className="quick-study-panel" aria-label="快速学习">
      <div className={`quick-study-head${selectionMode ? " quick-study-selection-head" : ""}`}>
        {selectionMode ? (
          <>
            <button className="quick-study-selection-cancel" onClick={exitSelectionMode}>取消</button>
            <b className="quick-study-selection-count">已选 {selectedIds.size} 个</b>
            <div
              className="quick-study-selection-rates"
              onPointerDown={startRatingGesture}
              onPointerMove={moveRatingGesture}
              onPointerUp={endRatingGesture}
              onPointerCancel={endRatingGesture}
            >
              {answerOptions.map((option) => (
                <button
                  key={option.value}
                  className={`quick-study-selection-rate quick-study-rating-${option.value}`}
                  data-batch-rating={option.value}
                  disabled={!selectedIds.size}
                  onClick={() => applySelectionRating(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="quick-study-title">
              <span className="quick-study-kick"><ListChecks size={13} /> {heading ?? "快速学习"}</span>
              <b>{loading
                ? "正在准备词卡…"
                : cards.length
                  ? `${batchMode ? "今天的顽固词" : phaseLabel(phase)} · 第 ${pageNumber} 页 · ${cards.length} 条`
                  : "这一轮完成了"}</b>
            </div>
            <div className="quick-study-actions">
              <button
                className="quick-study-action"
                onClick={toggleAllAnswers}
                disabled={loading || !cards.length}
                title={allRevealed ? "隐藏全部答案" : "显示全部答案"}
              >
                <Eye size={13} />
                {allRevealed ? "隐藏答案" : "显示答案"}
              </button>
              <button className="quick-study-submit" onClick={prepareSubmit} disabled={loading || submitting || !cards.length}>
                <Send size={13} />
                {submitting ? "整理中" : "提交"}
              </button>
            </div>
          </>
        )}
      </div>

      {error && <p className="quick-study-error">{error}</p>}

      {loading ? (
        <div className="quick-study-empty">正在把今天的词排好…</div>
      ) : cards.length ? (
        <div className="quick-study-list">
          {cards.map((card, index) => {
            const rating = ratings[card.id] ?? DEFAULT_QUICK_RATING;
            const selectedOption = answerOptions.find((option) => option.value === rating) ?? defaultRatingOption;
            const revealed = revealedIds.has(card.id);
            const primary = primaryAnswerText(card) || card.kanji || card.kana;
            const secondary = secondaryAnswerText(card);
            return (
              <div
                className={`quick-study-row${selectionMode ? " quick-study-row-selecting" : ""}`}
                key={card.id}
                data-quick-word-id={card.id}
                {...selection.rowHandlers(card.id)}
                onClick={(event) => handleRowClick(event, card.id)}
              >
                {selectionMode ? (
                  <button
                    className={`quick-study-select-circle${selectedIds.has(card.id) ? " selected" : ""}`}
                    aria-label={selectedIds.has(card.id) ? "取消选择" : "选择词条"}
                    aria-pressed={selectedIds.has(card.id)}
                    onClick={(event) => { event.stopPropagation(); selection.toggle(card.id); }}
                  >
                    {selectedIds.has(card.id) ? "✓" : ""}
                  </button>
                ) : (
                  <span className="quick-study-index">{String(index + 1).padStart(2, "0")}</span>
                )}
                <div className="quick-study-content">
                  <div className="quick-study-meaning-line">
                    <div className="quick-study-meaning">
                      <span>{card.questionMeaning || card.primaryMeaning || card.meaning}</span>
                      <div className="quick-study-meta">
                        <small>{card.jlptLevel} · {card.pos || "词汇"}</small>
                        {card.honorificLabel && (
                          <strong className="quick-study-honorific">{card.honorificLabel}</strong>
                        )}
                      </div>
                    </div>
                    {revealed && (
                      <div className="quick-study-answer" aria-label={`${primary} ${secondary}`}>
                        <b>{primary}</b>
                        {secondary && secondary !== primary && <small>{secondary}</small>}
                      </div>
                    )}
                  </div>
                  <div className="quick-study-row-actions">
                    <button className={`quick-study-answer-button${revealed ? " on" : ""}`} onClick={() => toggleAnswer(card.id)}>
                      答
                    </button>
                    <div className={`quick-study-rating-wrap${ratingOpenId === card.id ? " quick-study-rating-wrap-open" : ""}`}>
                      <button
                        className={`quick-study-rating quick-study-rating-${rating}`}
                        onClick={(event) => toggleRating(event, card.id)}
                        aria-expanded={ratingOpenId === card.id}
                        aria-label={`${selectedOption.label}，打开学习度选项`}
                      >
                        <span>{selectedOption.label}</span>
                        <ChevronDown size={12} />
                      </button>
                      {ratingOpenId === card.id && (
                        <div className={`quick-study-rating-popover${ratingPlacement === "down" ? " quick-study-rating-popover-down" : ""}`} role="menu">
                          {answerOptions.map((option) => (
                            <button
                              key={option.value}
                              className={rating === option.value ? "selected" : ""}
                              onClick={() => selectRating(card.id, option.value)}
                              role="menuitem"
                            >
                              <span>{option.label}</span>
                              {rating === option.value && <span aria-hidden="true">✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="quick-study-empty">
          <b>当前没有待复习词</b>
          <span>想继续巩固，可以进入完整学习页。</span>
          <button onClick={() => onNavigate("word")}>进入单词学习 →</button>
        </div>
      )}

      {submitSummary && (
        <div className="quick-study-confirm-backdrop" role="presentation">
          <div className="quick-study-confirm" role="dialog" aria-modal="true" aria-labelledby="quick-study-confirm-title">
            <h2 id="quick-study-confirm-title">确认提交</h2>
            <p className="quick-study-confirm-lead">本页提交共 {submitSummary.total} 个词：</p>
            <div className="quick-study-confirm-summary">
              {answerOptions.map((option) => (
                <div className={`quick-study-confirm-item quick-study-rating-${option.value}`} key={option.value}>
                  <span>{option.label}</span>
                  <b>{submitSummary.counts[option.value]}</b>
                </div>
              ))}
            </div>
            <p className="quick-study-confirm-next">提交后自动进入下一页</p>
            <div className="quick-study-confirm-actions">
              <button className="quick-study-confirm-cancel" onClick={() => setSubmitSummary(null)}>取消</button>
              <button className="quick-study-confirm-ok" onClick={confirmSubmit}>提交本页并继续</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
