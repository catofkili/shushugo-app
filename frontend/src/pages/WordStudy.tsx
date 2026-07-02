import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Eye, RotateCcw, Star, StickyNote, X } from "lucide-react";
import { WordAnswer, WordCard, WordLevelFilter, WordSessionResponse, WordStats, WordTypeFilter } from "../types/vocabulary";
import { addWordStudySeconds, continueKanjiStudy, continueStage2Study, getWordSession, submitWordAnswer, toggleFavorite, undoLastWordAnswer, updateWordNote } from "../lib/api";
import { getStudyPreferences, PREFERENCES_EVENT, StudyPreferences } from "../lib/studyPreferences";
import { addStudyTime, checkAchievements } from "../lib/userProfile";
import { triggerMemoryHaptic } from "../lib/haptics";
import { FinishPanel, KanjiAnswer } from "../features/word-study/WordStudyPanels";
import {
  answerReadingText,
  answerOptions,
  cardLabel,
  kanaToRomaji,
  levelOptions,
  primaryAnswerText,
  secondaryAnswerText,
  typeOptions
} from "../features/word-study/word-study-utils";
import type { StudyMode } from "../types/app";

interface WordStudyProps {
  initialMode?: StudyMode;
}

export const WordStudy = ({ initialMode = "classic" }: WordStudyProps) => {
  const [card, setCard] = useState<WordCard | null>(null);
  const [stats, setStats] = useState<WordStats | null>(null);
  const [phase, setPhase] = useState("loading");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteMemoryOpen, setNoteMemoryOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const [selectedLevel, setSelectedLevel] = useState<WordLevelFilter>(() => (localStorage.getItem("mn-word-level") as WordLevelFilter | null) ?? "All");
  const [selectedType, setSelectedType] = useState<WordTypeFilter>(() => (localStorage.getItem("mn-word-type") as WordTypeFilter | null) ?? "all");
  const [preferences, setPreferences] = useState<StudyPreferences>(() => getStudyPreferences());
  const [error, setError] = useState("");
  const lastStudyTickRef = useRef(Date.now());
  const trackingActiveRef = useRef(false);
  const submittingRef = useRef(false);

  const progressText = useMemo(() => {
    if ((selectedLevel !== "All" || selectedType !== "all") && stats?.total) {
      return `${stats.knownForever}/${stats.total}`;
    }
    if (!stats?.stage1ProgressTotal) return "";
    return `${stats.stage1ProgressDone}/${stats.stage1ProgressTotal}`;
  }, [selectedLevel, selectedType, stats]);

  const markedKanji = useMemo(() => {
    return (card?.kanjiComponents ?? []).filter((component) => component.marked);
  }, [card]);

  const romaji = useMemo(() => card ? kanaToRomaji(secondaryAnswerText(card)) : "", [card]);

  const sessionOptions = useMemo(() => ({
    level: selectedLevel,
    type: selectedType
  }), [selectedLevel, selectedType]);

  const loadNext = async (mode: StudyMode = initialMode) => {
    setLoading(true);
    setError("");
    try {
      let data: WordSessionResponse;
      if (mode === "reverse") {
        data = continueStage2Study();
      } else if (mode === "kanji") {
        data = continueKanjiStudy();
      } else {
        data = getWordSession(sessionOptions);
      }
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取本地词库");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("mn-word-level", selectedLevel);
    localStorage.setItem("mn-word-type", selectedType);
    loadNext(initialMode);
  }, [selectedLevel, selectedType, initialMode]);

  useEffect(() => {
    const handlePreferences = (event: Event) => {
      setPreferences((event as CustomEvent<StudyPreferences>).detail ?? getStudyPreferences());
    };
    window.addEventListener(PREFERENCES_EVENT, handlePreferences);
    return () => window.removeEventListener(PREFERENCES_EVENT, handlePreferences);
  }, []);

  const playPronunciation = (text: string) => {
    if (!preferences.autoPlay || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  };

  const sendStudySeconds = async (seconds: number) => {
    if (seconds <= 0) return null;
    setLocalStudySeconds((value) => value + seconds);
    try {
      const data = addWordStudySeconds(seconds);
      setStats(data.stats);
      setLocalStudySeconds(0);

      // 同步到用户资料（分钟）
      const minutes = Math.floor(seconds / 60);
      if (minutes > 0) {
        await addStudyTime(minutes);
        // 检查是否解锁新成就
        await checkAchievements();
      }

      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      return null;
    }
  };

  const elapsedStudySeconds = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - lastStudyTickRef.current) / 1000);
    lastStudyTickRef.current = now;
    if (document.visibilityState !== "visible" || elapsed <= 0) return 0;
    return Math.min(elapsed, 60);
  };

  useEffect(() => {
    trackingActiveRef.current = Boolean(card);
    lastStudyTickRef.current = Date.now();
  }, [card?.id]);

  useEffect(() => {
    const flushStudyTime = async () => {
      if (!trackingActiveRef.current) return;
      await sendStudySeconds(elapsedStudySeconds());
    };

    const interval = window.setInterval(flushStudyTime, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushStudyTime();
      } else {
        lastStudyTickRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      flushStudyTime();
    };
  }, []);

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
  }, [card?.id]);

  const submitAnswer = async (answer: WordAnswer) => {
    // submittingRef is synchronous, so a second tap is blocked immediately —
    // before React can re-render the `disabled`/`submitting` state — which is
    // what the `submitting` state alone could miss on a fast double-tap.
    if (!card || submittingRef.current || submitting) return;
    submittingRef.current = true;
    triggerMemoryHaptic(answer);
    setSubmitting(true);
    setError("");
    try {
      const data = submitWordAnswer(card.id, answer, sessionOptions);
      let nextStats = data.stats;
      if (!data.card && trackingActiveRef.current) {
        trackingActiveRef.current = false;
        const trackedStats = await sendStudySeconds(elapsedStudySeconds());
        if (trackedStats) nextStats = trackedStats;
      }
      setCard(data.card);
      setStats(nextStats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const undo = async () => {
    setSubmitting(true);
    setError("");
    try {
      const data = undoLastWordAnswer();
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    } finally {
      setSubmitting(false);
    }
  };

  const saveNote = async () => {
    if (!card || noteSaving) return;
    setNoteSaving(true);
    setError("");
    try {
      const data = updateWordNote(card.id, noteText);
      setCard((current) => current && current.id === data.wordId ? { ...current, note: data.note } : current);
      setNoteText(data.note);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "便签保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleCardFavorite = () => {
    if (!card) return;
    setError("");
    try {
      const result = toggleFavorite("word", card.id);
      setCard({ ...card, isFavorite: result.isFavorite });
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏失败");
    }
  };

  const isReversePhase = phase === "stage2";
  const isKanjiPhase = phase === "kanji";
  const pageTitle = isReversePhase ? "反向学习" : isKanjiPhase ? "汉字学习" : initialMode === "classic" ? "经典模式" : "词汇学习";
  const pageLabel = isReversePhase ? "Reverse" : isKanjiPhase ? "Kanji" : initialMode === "classic" ? "Classic" : "Vocabulary";

  const startExtraPhase = (phaseName: "stage2" | "kanji") => {
    setLoading(true);
    setError("");
    try {
      const data = phaseName === "stage2" ? continueStage2Study() : continueKanjiStudy();
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法进入下一阶段");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-13rem)] min-h-[520px] max-w-4xl flex-col justify-center lg:h-[calc(100vh-4rem)] lg:min-h-[600px]">
      <section className="dictionary-card relative flex h-full min-h-0 flex-col rounded-2xl p-5 sm:p-8">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3 border-b border-white/15 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/65">{pageLabel}</p>
            <h1 className="mt-1 text-xl font-semibold">{pageTitle}</h1>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={selectedLevel}
                onChange={(event) => setSelectedLevel(event.target.value as WordLevelFilter)}
                className="focus-ring control-cyan soft-text-outline h-9 min-w-0 rounded-xl border px-2 text-xs font-bold"
                title="选择 JLPT 等级"
              >
                {levelOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as WordTypeFilter)}
                className="focus-ring control-cyan soft-text-outline h-9 min-w-0 rounded-xl border px-2 text-xs font-bold"
                title="选择词性或收藏"
              >
                {typeOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {progressText && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs text-white/70">{progressText}</span>}
            <button
              onClick={toggleCardFavorite}
              disabled={!card}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.isFavorite ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
              title={card?.isFavorite ? "取消收藏" : "收藏单词"}
            >
              <Star size={17} fill={card?.isFavorite ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => {
                setNoteMemoryOpen(false);
                setNoteEditorOpen((open) => !open);
              }}
              disabled={!card}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.note ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
              title={card?.note ? "编辑便签" : "添加便签"}
            >
              <StickyNote size={17} />
            </button>
            <button
              onClick={undo}
              disabled={submitting}
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
              title="上一个"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>

        {noteMemoryOpen && card?.note && (
          <div className="note-memory-card absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-2xl p-4 text-left sm:right-8 sm:top-24">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Memory Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteMemoryOpen(false)}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-[#81D8CF]/15"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-white/88">{card.note}</p>
          </div>
        )}

        {noteEditorOpen && card && (
          <div className="absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-2xl border border-white/20 bg-[#373b3b] p-4 text-left shadow-lg sm:right-8 sm:top-24">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Word Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteEditorOpen(false)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-36 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
              placeholder="写下自己的记忆法、易混点、例句或吐槽..."
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-white/45">留空并保存即可清除便签</p>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                className="focus-ring rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#2f3333] disabled:opacity-50"
              >
                {noteSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-4 text-sm text-white">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
              <p className="font-bold">暂时读不到本地词库</p>
              <p className="mt-1 text-white/75">请检查应用内是否包含 nihongo.db。</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[360px] place-items-center text-center text-white/75">正在读取下一题...</div>
        ) : card ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid min-h-28 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] p-4 text-center">
              <div className="max-h-28 w-full overflow-y-auto px-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">题目</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  {isReversePhase ? (
                    <>
                      <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{card.pos}</span>
                      <p className="jp-serif break-words text-4xl font-semibold leading-tight sm:text-6xl">{primaryAnswerText(card)}</p>
                      {answerReadingText(card) && <p className="jp text-xl text-white/72 sm:text-2xl">{answerReadingText(card)}</p>}
                    </>
                  ) : (
                    <>
                      {card.honorificLabel && (
                        <span className="rounded-sm border border-[#81D8CF]/45 bg-[#81D8CF]/18 px-2 py-1 text-xs font-black text-[#81D8CF]">
                          {card.honorificLabel}
                        </span>
                      )}
                      <p className="break-words text-xl font-semibold leading-snug sm:text-3xl">
                        {card.questionMeaning || card.meaning}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-6 text-center">
              {revealed ? (
                <div className="w-full">
                  {isReversePhase ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">释义</p>
                      <p className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-9 text-white/88">{card.meaning}</p>
                    </>
                  ) : (
                    <>
                      <p className="jp-serif text-7xl font-semibold leading-none sm:text-8xl">
                        <KanjiAnswer card={card} />
                      </p>
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        {card.jlptLevel && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{card.jlptLevel}</span>}
                        <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/60">{card.pos}</span>
                      </div>
                      {answerReadingText(card) && (
                        <p className="jp mt-4 text-4xl text-white/86 sm:text-5xl">{answerReadingText(card)}</p>
                      )}
                      {card.englishOrigin && (
                        <div className="mx-auto mt-4 w-fit rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 px-5 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">英语原词</p>
                          <p className="mt-1 text-2xl font-semibold text-white/90 sm:text-3xl">{card.englishOrigin}</p>
                        </div>
                      )}
                    </>
                  )}
                  {preferences.showRomaji && romaji && (
                    <p className="mt-2 text-sm font-semibold tracking-normal text-white/52">{romaji}</p>
                  )}
                  {!isReversePhase && <p className="mx-auto mt-7 max-w-2xl text-xl leading-9 text-white/82">{card.meaning}</p>}
                  {(markedKanji.length > 0 || card.verbPair || card.confusions.length > 0) && !isReversePhase && (
                    <div className="mx-auto mt-7 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
                      {markedKanji.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">和式汉字</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {markedKanji.map((component) => (
                              <span
                                key={`${component.char}-${component.simplified}`}
                                className="inline-flex items-center gap-2 rounded-sm border border-[#81D8CF]/25 bg-[#81D8CF]/20 px-2.5 py-1.5 text-sm font-semibold"
                              >
                                <span className="jp-serif kanji-variant-mark text-xl leading-none">{component.char}</span>
                                <span className="text-white/45">→</span>
                                <span className="text-white/86">{component.simplified}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {card.verbPair && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">自他动词对应</p>
                          <div className="mt-3 flex items-baseline justify-between gap-3">
                            <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{card.verbPair.pairVoice}</span>
                            <div className="text-right">
                              <p className="jp-serif text-2xl font-semibold leading-none">{card.verbPair.kanji}</p>
                              <p className="jp mt-1 text-base text-white/65">{card.verbPair.kana}</p>
                            </div>
                          </div>
                          {card.verbPair.meaning && <p className="mt-3 text-sm leading-6 text-white/75">{card.verbPair.meaning}</p>}
                          {card.verbPair.note && <p className="mt-2 text-xs leading-5 text-white/55">{card.verbPair.note}</p>}
                        </div>
                      )}

                      {card.confusions.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4 sm:col-span-2">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">易混词</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {card.confusions.slice(0, 3).map((item) => (
                              <div key={`${item.kind}-${item.kanji}-${item.kana}`} className="rounded-xl border border-white/10 bg-[#81D8CF]/10 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="jp-serif text-xl font-semibold leading-none">{item.kanji}</p>
                                  <span className="rounded-sm border border-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/45">{item.kind}</span>
                                </div>
                                <p className="jp mt-1 text-sm text-white/58">{item.kana}</p>
                                <p className="mt-2 text-xs leading-5 text-white/70">{item.meaning}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                  <p className="mt-3 text-sm text-white/55">{isReversePhase ? "先回忆中文释义" : "先回忆假名和汉字"}</p>
                </div>
              )}
            </div>

            <div className="h-16">
              {!revealed ? (
                <button
                  onClick={() => {
                    setRevealed(true);
                    setNoteEditorOpen(false);
                    if (card?.note) setNoteMemoryOpen(true);
                    if (card) playPronunciation(secondaryAnswerText(card));
                  }}
                  className="focus-ring inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
                >
                  <Eye size={18} />
                  显示答案
                </button>
              ) : (
                <div className="grid h-16 grid-cols-4 gap-3">
                  {answerOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => submitAnswer(option.value)}
                      disabled={submitting}
                      className="focus-ring h-16 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15 disabled:opacity-50"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <FinishPanel
            stats={stats}
            phase={phase}
            localSeconds={localStudySeconds}
            onContinueStage2={() => startExtraPhase("stage2")}
            onContinueKanji={() => startExtraPhase("kanji")}
          />
        )}
      </section>
    </div>
  );
};
