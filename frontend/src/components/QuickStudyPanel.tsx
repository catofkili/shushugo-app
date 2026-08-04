import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Eye, ListChecks, Send } from "lucide-react";
import { getQuickStudySession, submitQuickStudyBatch } from "../lib/api";
import { clearQuickStudyDraft, loadQuickStudyDraft, saveQuickStudyDraft } from "../lib/quick-study-draft";
import { answerOptions, primaryAnswerText, secondaryAnswerText } from "../features/word-study/word-study-utils";
import type { Page } from "../types/app";
import type { WordAnswer, WordCard } from "../types/vocabulary";

type Props = {
  onNavigate: (page: Page) => void;
  variant?: "entry" | "page";
};

type SubmitSummary = {
  total: number;
  counts: Record<WordAnswer, number>;
};

const QUICK_STUDY_PAGE_SIZE = 50;
const QUICK_STUDY_PREFETCH_SIZE = QUICK_STUDY_PAGE_SIZE * 2;

const initialRatings = (cards: WordCard[]) => Object.fromEntries(
  cards.map((card) => [card.id, "know" as WordAnswer])
) as Record<number, WordAnswer>;

const yieldToBrowser = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

const phaseLabel = (phase: string) => {
  if (phase === "stage2") return "反向复习";
  if (phase === "kanji") return "汉字复习";
  return "今日词汇";
};

export function QuickStudyPanel({ onNavigate, variant = "page" }: Props) {
  const [cards, setCards] = useState<WordCard[]>([]);
  const [nextCards, setNextCards] = useState<WordCard[]>([]);
  const [seenWordIds, setSeenWordIds] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState("stage1");
  const [ratings, setRatings] = useState<Record<number, WordAnswer>>({});
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [ratingOpenId, setRatingOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [submitSummary, setSubmitSummary] = useState<SubmitSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const selectionDraggedRef = useRef(false);
  const selectionGestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const ratingGesturePointerRef = useRef<number | null>(null);

  const load = useCallback(async (restoreDraft = false) => {
    setLoading(true);
    setError("");
    try {
      // 先让页面把标题和首屏容器画出来,再做同步词库查询。
      await yieldToBrowser();
      if (restoreDraft) {
        const draft = await loadQuickStudyDraft();
        if (draft) {
          const seenIds = new Set(draft.seenWordIds);
          let prefetchedNext = draft.nextCards;
          if (!prefetchedNext.length) {
            const nextData = getQuickStudySession(QUICK_STUDY_PAGE_SIZE, [...seenIds]);
            if (nextData.phase === draft.phase) {
              prefetchedNext = nextData.cards;
              prefetchedNext.forEach((card) => seenIds.add(card.id));
            }
          }
          setCards(draft.cards);
          setNextCards(prefetchedNext);
          setSeenWordIds(seenIds);
          setPhase(draft.phase);
          setRatings(draft.ratings);
          setRevealedIds(new Set(draft.revealedIds));
          setRatingOpenId(null);
          setPageNumber(draft.pageNumber);
          setSelectionMode(draft.selectionMode);
          setSelectedIds(new Set(draft.selectedIds));
          return;
        }
      }
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
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "暂时无法读取快速学习内容");
    } finally {
      setLoading(false);
    }
  }, []);

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
    if (variant === "entry" || !draftHydrated || loading || submitting || !cards.length) return;
    void saveQuickStudyDraft({
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
  }, [cards, draftHydrated, loading, nextCards, pageNumber, phase, ratings, revealedIds, seenWordIds, selectedIds, selectionMode, submitting, variant]);

  const toggleAnswer = (wordId: number) => {
    setRevealedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  const selectRowsAlongPath = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const minX = Math.min(fromX, toX);
    const maxX = Math.max(fromX, toX);
    const minY = Math.min(fromY, toY);
    const maxY = Math.max(fromY, toY);
    const ids: number[] = [];
    document.querySelectorAll<HTMLElement>(".quick-study-row[data-quick-word-id]").forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.right >= minX && rect.left <= maxX && rect.bottom >= minY && rect.top <= maxY) {
        const id = Number(row.dataset.quickWordId);
        if (Number.isFinite(id)) ids.push(id);
      }
    });
    if (!ids.length) return;
    if (Math.abs(toX - fromX) > 8 || Math.abs(toY - fromY) > 8) selectionDraggedRef.current = true;
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const beginSelectionGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>, wordId: number) => {
    selectionGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    selectionDraggedRef.current = false;
    setSelectedIds((current) => new Set(current).add(wordId));

    const handleMove = (moveEvent: PointerEvent) => {
      const gesture = selectionGestureRef.current;
      if (!gesture || gesture.pointerId !== moveEvent.pointerId) return;
      selectRowsAlongPath(gesture.x, gesture.y, moveEvent.clientX, moveEvent.clientY);
      gesture.x = moveEvent.clientX;
      gesture.y = moveEvent.clientY;
      if (moveEvent.clientY < 72) window.scrollBy(0, -12);
      else if (moveEvent.clientY > window.innerHeight - 72) window.scrollBy(0, 12);
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (selectionGestureRef.current?.pointerId !== endEvent.pointerId) return;
      selectionCleanupRef.current?.();
      selectionCleanupRef.current = null;
      selectionGestureRef.current = null;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
    selectionCleanupRef.current?.();
    selectionCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", handleEnd, { passive: true });
    window.addEventListener("pointercancel", handleEnd, { passive: true });
  }, [selectRowsAlongPath]);

  const startLongPress = (event: ReactPointerEvent<HTMLDivElement>, wordId: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    if (selectionMode) {
      beginSelectionGesture(event, wordId);
      return;
    }
    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      setSelectionMode(true);
      setSelectedIds(new Set([wordId]));
      setRatingOpenId(null);
      beginSelectionGesture(event, wordId);
    }, 460);
  };

  const moveLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = longPressOriginRef.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearLongPress();
  };

  const finishLongPress = () => clearLongPress();

  const toggleSelected = (wordId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>, wordId: number) => {
    if (longPressTriggeredRef.current || selectionDraggedRef.current) {
      longPressTriggeredRef.current = false;
      selectionDraggedRef.current = false;
      return;
    }
    if (!selectionMode || (event.target as HTMLElement).closest("button")) return;
    toggleSelected(wordId);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setRatingOpenId(null);
  };

  const applySelectionRating = useCallback((answer: WordAnswer) => {
    if (!selectedIds.size) return;
    setRatings((current) => {
      const next = { ...current };
      selectedIds.forEach((wordId) => { next[wordId] = answer; });
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

  const prepareSubmit = () => {
    if (!cards.length || submittingRef.current) return;
    setError("");
    const counts = answerOptions.reduce<Record<WordAnswer, number>>((result, option) => {
      result[option.value] = 0;
      return result;
    }, {} as Record<WordAnswer, number>);
    cards.forEach((card) => {
      const answer = ratings[card.id] ?? "know";
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
        cards.map((card) => ({ wordId: card.id, answer: ratings[card.id] ?? "know" })),
        phase
      );

      setSubmitSummary(null);
      const nextPageNumber = pageNumber + 1;

      if (nextCards.length) {
        // 下一页在提交前就已经固定：先立刻切页，再准备下下页。
        const nextPage = nextCards;
        const nextRatings = initialRatings(nextPage);
        const nextSeenIds = new Set(seenWordIds);
        const saveReadyPage = saveQuickStudyDraft({
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
        setSelectionMode(false);
        setSelectedIds(new Set());
        panelRef.current?.scrollIntoView({ block: "start" });

        await yieldToBrowser();
        const followingData = getQuickStudySession(QUICK_STUDY_PAGE_SIZE, [...nextSeenIds]);
        if (followingData.phase === phase && followingData.cards.length) {
          const followingPage = followingData.cards;
          followingPage.forEach((card) => nextSeenIds.add(card.id));
          setNextCards(followingPage);
          setSeenWordIds(new Set(nextSeenIds));
          await saveQuickStudyDraft({
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
      const nextPass = getQuickStudySession(QUICK_STUDY_PREFETCH_SIZE);
      const nextPage = nextPass.cards.slice(0, QUICK_STUDY_PAGE_SIZE);
      const followingPage = nextPass.cards.slice(QUICK_STUDY_PAGE_SIZE);
      const nextPhase = nextPass.phase;
      const nextSeenIds = new Set(nextPass.cards.map((card) => card.id));

      if (!nextPage.length) {
        await clearQuickStudyDraft();
        setCards([]);
        setNextCards([]);
        setSeenWordIds(new Set());
        setRatings({});
        setRevealedIds(new Set());
        setSelectionMode(false);
        setSelectedIds(new Set());
        return;
      }

      const nextRatings = initialRatings(nextPage);
      const saveNextPage = saveQuickStudyDraft({
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
      setSelectionMode(false);
      setSelectedIds(new Set());
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
        <span className="zoo-tile-quick-emoji" aria-hidden="true">📝</span>
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
              <span className="quick-study-kick"><ListChecks size={13} /> 快速学习</span>
              <b>{loading ? "正在准备词卡…" : cards.length ? `${phaseLabel(phase)} · 第 ${pageNumber} 页 · ${cards.length} 条` : "这一轮完成了"}</b>
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
            const rating = ratings[card.id] ?? "know";
            const selectedOption = answerOptions.find((option) => option.value === rating) ?? answerOptions[2];
            const revealed = revealedIds.has(card.id);
            const primary = primaryAnswerText(card) || card.kanji || card.kana;
            const secondary = secondaryAnswerText(card);
            return (
              <div
                className={`quick-study-row${selectionMode ? " quick-study-row-selecting" : ""}`}
                key={card.id}
                data-quick-word-id={card.id}
                onPointerDown={(event) => startLongPress(event, card.id)}
                onPointerMove={moveLongPress}
                onPointerUp={finishLongPress}
                onPointerCancel={finishLongPress}
                onClick={(event) => handleRowClick(event, card.id)}
                onContextMenu={(event) => event.preventDefault()}
              >
                {selectionMode ? (
                  <button
                    className={`quick-study-select-circle${selectedIds.has(card.id) ? " selected" : ""}`}
                    aria-label={selectedIds.has(card.id) ? "取消选择" : "选择词条"}
                    aria-pressed={selectedIds.has(card.id)}
                    onClick={(event) => { event.stopPropagation(); toggleSelected(card.id); }}
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
                    <div className="quick-study-rating-wrap">
                      <button
                        className={`quick-study-rating quick-study-rating-${rating}`}
                        onClick={() => setRatingOpenId((current) => current === card.id ? null : card.id)}
                        aria-expanded={ratingOpenId === card.id}
                        aria-label={`${selectedOption.label}，打开学习度选项`}
                      >
                        <span>{selectedOption.label}</span>
                        <ChevronDown size={12} />
                      </button>
                      {ratingOpenId === card.id && (
                        <div className="quick-study-rating-popover" role="menu">
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
