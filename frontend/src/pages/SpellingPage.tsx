import { useCallback, useEffect, useRef, useState } from "react";
import { Sticker } from "../components/CapybaraMascot";
import { SpellingCardView } from "../features/spelling/SpellingCardView";
import { nextSpellingCard } from "../features/spelling/queue";
import {
  SPELLING_MARKER, checkCardInput, clearSpellingTasks, createSpellingTasks, ensureSpellingTables,
  pickSpellingNext, recordSpellingRound, seedSpellingCards, spellingCard, spellingLookup,
  spellingProgress, undoLastSpelling, type SpellingCard, type SpellingLookup, type SpellingRound
} from "../lib/spelling";
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
}

export function SpellingPage() {
  const [page, setPage] = useState<PageState>({
    ready: false, card: null, lookup: null, instance: 0,
    progress: { total: 0, done: 0, remaining: 0 },
    autoPlay: false, voiceId: "", undoAvailable: true, seeded: 0, error: ""
  });
  const initialized = useRef(false);
  const seeded = useRef(0);
  const freshQuota = useRef(INITIAL_FRESH);
  const pendingUndo = useRef<number | null>(null);

  const showNext = useCallback(() => {
    const undoneWordId = pendingUndo.current;
    const card = undoneWordId === null ? nextSpellingCard(pickSpellingNext, spellingCard) : spellingCard(undoneWordId);
    if (undoneWordId !== null && !card) throw new Error("撤销的词已不存在");
    const progress = spellingProgress();
    // 词条失效不等于练完，不能给一份仍有待练项的清单画完成贴纸。
    if (!card && progress.remaining > 0) throw new Error("拼写清单中有无法打开的词");
    const lookup = card ? spellingLookup(card.wordId) : null;
    const preferences = getStudyPreferences();
    const seededCount = seeded.current;
    pendingUndo.current = null;
    setPage((current) => ({
      ...current, ready: true, card, lookup, progress, instance: current.instance + 1,
      seeded: seededCount,
      autoPlay: preferences.autoPlay, voiceId: preferences.voiceId, error: ""
    }));
  }, []);

  const initialize = useCallback(() => {
    try {
      ensureSpellingTables();
      seeded.current += seedSpellingCards(SEED_LIMIT);
      createSpellingTasks({ fresh: freshQuota.current, review: REVIEW_LIMIT });
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

  const finish = (round: SpellingRound) => {
    if (!page.card) return;
    recordSpellingRound(page.card.wordId, round);
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
    const nextQuota = freshQuota.current + EXTRA_FRESH;
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
  return (
    <section className="sp-page" data-spelling-experiment={SPELLING_MARKER} aria-label="单词拼写">
      <header className="sp-header">
        <p className="sp-progress ds-num" aria-label={`已练 ${page.progress.done}，总数 ${page.progress.total}`}>
          已练 {page.progress.done} / {page.progress.total}
        </p>
        <button type="button" className="ds-btn-soft sp-button" disabled={!page.ready || !page.undoAvailable}
          aria-label="撤销上一次拼写" onClick={undo}>撤销</button>
      </header>
      {page.error && <div className="sp-page-error" role="status">
        <p>{page.error}</p>
        {!page.card && <button type="button" className="ds-btn-soft sp-button" onClick={initialize}>重试</button>}
      </div>}
      {page.card ? <SpellingCardView
        key={page.instance}
        card={page.card}
        onFinish={finish}
        onNext={showNext}
        checkInput={(typed) => checkCardInput(page.card!, typed, page.lookup ?? undefined)}
        autoPlay={page.autoPlay}
        voiceId={page.voiceId}
      /> : !page.ready ? (!page.error && <p className="sp-loading" role="status">正在准备</p>)
        : <div className="sp-empty">
          <Sticker name={empty ? "empty-box" : "empty-done"} size={120} />
          <p className="sp-empty-title">{empty ? "先去背几个词，再来拼写" : `今天练完了 ${page.progress.done} 个`}</p>
          {!empty && <button type="button" className="ds-btn sp-button" onClick={practiceMore}>再练 10 个</button>}
        </div>}
    </section>
  );
}
