import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Sticker } from "../components/CapybaraMascot";
import { SpellingCardView } from "../features/spelling/SpellingCardView";
import { nextSpellingCard } from "../features/spelling/queue";
import { SpellingSettings } from "../features/spelling/SpellingSettings";
import { SpellingStats } from "../features/spelling/SpellingStats";
import {
  SPELLING_MARKER, checkCardInput, clearSpellingTasks, createSpellingTasks, ensureSpellingTables,
  pickSpellingNext, recordSpellingAnswer, gradeRound, roundOutcome, seedSpellingCards, spellingCard, spellingLookup,
  spellingProgress, undoLastSpelling, amendSpellingRound, availableSpellingModes, chooseSpellingMode,
  getSpellingPrefs, SPELLING_PREFS_EVENT, spellingDoneToday,
  type SpellingCard, type SpellingLookup, type SpellingRound, type SpellingPrefs
} from "../lib/spelling";
import { firstValue } from "../lib/study-core";
import { getStudyPreferences } from "../lib/studyPreferences";
import "./spelling.css";

// 落地方式未定，数字只是实验默认值。
const SEED_LIMIT = 30;
const INITIAL_FRESH = 10;
const REVIEW_LIMIT = 30;
const EXTRA_FRESH = 10;

interface PageState {
  ready: boolean;
  card: SpellingCard | null;
  lookup: SpellingLookup | null;
  instance: number;
  progress: { total: number; done: number; remaining: number };
  autoPlay: boolean;
  voiceId: string;
  undoAvailable: boolean;
  seeded: number;
  error: string;
  cardPrefs: SpellingPrefs;
}

export function SpellingPage() {
  const [page, setPage] = useState<PageState>({
    ready: false, card: null, lookup: null, instance: 0,
    progress: { total: 0, done: 0, remaining: 0 },
    autoPlay: false, voiceId: "", undoAvailable: true, seeded: 0, error: "", cardPrefs: getSpellingPrefs()
  });
  const [prefs, setPrefs] = useState(getSpellingPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prefsRef = useRef(prefs);
  const replan = useRef(false);
  const initialized = useRef(false);
  const seeded = useRef(0);
  const freshQuota = useRef(INITIAL_FRESH);
  const pendingUndo = useRef<number | null>(null);
  const updatePrefs = useCallback((next: SpellingPrefs) => {
    replan.current ||= next.dailyCap !== prefsRef.current.dailyCap || next.minStabilityDays !== prefsRef.current.minStabilityDays;
    prefsRef.current = next;
    setPrefs(next);
  }, []);

  const freshBudget = (preferences: SpellingPrefs) => preferences.dailyCap === 0
    ? freshQuota.current : Math.min(freshQuota.current, Math.max(0, preferences.dailyCap - spellingDoneToday()));

  const showNext = useCallback(() => {
    const prefs = prefsRef.current;
    if (replan.current) {
      clearSpellingTasks();
      seeded.current += seedSpellingCards(SEED_LIMIT, prefs);
      createSpellingTasks({ fresh: freshBudget(prefs), review: REVIEW_LIMIT }, undefined, prefs);
      replan.current = false;
    }
    const cardFor = (wordId: number) => spellingCard(wordId, chooseSpellingMode(wordId, prefs, availableSpellingModes(wordId)));
    const capReached = prefs.dailyCap > 0 && spellingDoneToday() >= prefs.dailyCap;
    const pick = (_day?: string, excluded = new Set<string>()) => {
      let next = pickSpellingNext(undefined, excluded);
      while (next !== null && capReached && firstValue<number>("SELECT seen_count FROM spelling_memory WHERE word_id = ?", [next], 0) === 0) {
        excluded.add(String(next));
        next = pickSpellingNext(undefined, excluded);
      }
      return next;
    };
    const undoneWordId = pendingUndo.current;
    const card = undoneWordId === null ? nextSpellingCard(pick, cardFor) : cardFor(undoneWordId);
    if (undoneWordId !== null && !card) throw new Error("撤销的词已不存在");
    const progress = spellingProgress();
    // 词条失效不等于练完，不能给一份仍有待练项的清单画完成贴纸。
    if (!card && progress.remaining > 0 && !capReached) throw new Error("拼写清单中有无法打开的词");
    const lookup = card ? spellingLookup(card.wordId) : null;
    const preferences = getStudyPreferences();
    const seededCount = seeded.current;
    pendingUndo.current = null;
    setPage((current) => ({
      ...current, ready: true, card, lookup, progress, instance: current.instance + 1,
      seeded: seededCount,
      autoPlay: preferences.autoPlay, voiceId: preferences.voiceId, error: "", cardPrefs: prefs
    }));
  }, []);

  const initialize = useCallback(() => {
    try {
      ensureSpellingTables();
      const prefs = prefsRef.current;
      seeded.current += seedSpellingCards(SEED_LIMIT, prefs);
      createSpellingTasks({ fresh: freshBudget(prefs), review: REVIEW_LIMIT }, undefined, prefs);
      showNext();
    } catch {
      setPage((current) => ({ ...current, error: "暂时打不开拼写练习，请重试" }));
    }
  }, [showNext]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initialize();
  }, [initialize]);

  useEffect(() => {
    const handlePrefs = (event: Event) => {
      const next = (event as CustomEvent<SpellingPrefs>).detail ?? getSpellingPrefs();
      updatePrefs(next);
    };
    window.addEventListener(SPELLING_PREFS_EVENT, handlePrefs);
    return () => window.removeEventListener(SPELLING_PREFS_EVENT, handlePrefs);
  }, [updatePrefs]);

  const finish = (round: SpellingRound) => {
    if (!page.card) return;
    const outcome = roundOutcome(round);
    const last = round.attempts[round.attempts.length - 1];
    recordSpellingAnswer(page.card.wordId, gradeRound(round), {
      typed: last?.typed ?? "", form: last?.verdict.form ?? "empty", hints: round.hintsUsed,
      tries: outcome.tries, ms: Math.max(0, Math.round(round.elapsedMs)),
      problem: round.gaveUp ? "gave_up" : last && !last.verdict.correct ? last.verdict.problems[0]?.code ?? "" : "",
      override: outcome.overridden ? round.override : "", mode: page.card.mode, source: "page"
    });
    // 读进度失败也不能把已写入的作答重新提交；结算异常才交给卡片重试。
    try {
      const progress = spellingProgress();
      setPage((current) => ({ ...current, progress, undoAvailable: true, error: "" }));
    } catch {
      setPage((current) => ({ ...current, undoAvailable: true, error: "进度暂时没能更新" }));
    }
  };

  const undo = () => {
    try {
      const wordId = pendingUndo.current ?? undoLastSpelling();
      if (wordId === null) {
        setPage((current) => ({ ...current, undoAvailable: false }));
        return;
      }
      // 撤销成功但读卡失败时保留词 id；重试读卡，不能再撤销一条别的流水。
      pendingUndo.current = wordId;
      showNext();
    } catch {
      setPage((current) => ({
        ...current, ready: pendingUndo.current === null && current.ready,
        card: pendingUndo.current === null ? current.card : null,
        error: "暂时没能打开撤销的词，请重试"
      }));
    }
  };

  const practiceMore = () => {
    // 已练完的卡不再算新卡，所以「再练」就是再要 10 张没练过的，不是在原额度上累加
    const nextQuota = EXTRA_FRESH;
    try {
      clearSpellingTasks();
      freshQuota.current = nextQuota;
      setPage((current) => ({ ...current, ready: false, card: null, lookup: null, error: "" }));
      initialize();
    } catch {
      setPage((current) => ({ ...current, error: "暂时没能开始下一组，请重试" }));
    }
  };

  const empty = page.ready && page.seeded === 0 && page.progress.total === 0;
  const capReached = page.ready && prefs.dailyCap > 0 && spellingDoneToday() >= prefs.dailyCap;
  return (
    <section className="sp-page" data-spelling-experiment={SPELLING_MARKER} aria-label="单词拼写">
      <header className="sp-header">
        <p className="sp-progress ds-num" aria-label={`已练 ${page.progress.done}，总数 ${page.progress.total}`}>
          已练 {page.progress.done} / {page.progress.total}
        </p>
        <div className="flex gap-2"><button type="button" className="ds-btn-soft sp-button" disabled={!page.ready || !page.undoAvailable}
          aria-label="撤销上一次拼写" onClick={undo}>撤销</button>
          <button type="button" className="ds-btn-soft sp-button" aria-label="拼写设置" aria-expanded={settingsOpen}
            aria-controls="spelling-settings" onClick={() => setSettingsOpen((value) => !value)}><SlidersHorizontal size={18} /></button></div>
      </header>
      {settingsOpen && <SpellingSettings prefs={prefs} onChange={(next) => {
        updatePrefs(next);
        if (page.ready && !page.card) {
          try { showNext(); }
          catch { setPage((current) => ({ ...current, error: "暂时没能更新拼写练习，请重试" })); }
        }
      }} onClose={() => setSettingsOpen(false)} />}
      {page.error && <div className="sp-page-error" role="status">
        <p>{page.error}</p>
        {!page.card && <button type="button" className="ds-btn-soft sp-button" onClick={initialize}>重试</button>}
      </div>}
      {page.card ? <SpellingCardView
        key={page.instance}
        card={page.card}
        onFinish={finish}
        onNext={showNext}
        onAmend={(round) => {
          if (!page.card) return;
          amendSpellingRound(page.card.wordId, round);
          try {
            const progress = spellingProgress();
            setPage((current) => ({ ...current, progress, error: "" }));
          } catch {
            setPage((current) => ({ ...current, error: "进度暂时没能更新" }));
          }
        }}
        checkInput={(typed) => checkCardInput(page.card!, typed, page.lookup ?? undefined)}
        autoPlay={page.autoPlay}
        voiceId={page.voiceId}
        showMeaning={page.cardPrefs.showMeaningInAudio}
        showTranslation={page.cardPrefs.clozeShowTranslation}
      /> : !page.ready ? (!page.error && <p className="sp-loading" role="status">正在准备</p>)
        : <div className="sp-empty">
          <Sticker name={empty ? "empty-box" : "empty-done"} size={120} />
          <p className="sp-empty-title">{capReached ? "今天的拼写额度用完了" : empty ? "先去背几个词，再来拼写" : `今天练完了 ${page.progress.done} 个`}</p>
          {!empty && !capReached && <button type="button" className="ds-btn sp-button" onClick={practiceMore}>再练 10 个</button>}
        </div>}
      {page.ready && <SpellingStats />}
    </section>
  );
}
