import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Layers, Search, Star, StickyNote, X, XCircle } from "lucide-react";
import { FloatingDoodlePen } from "../components/FloatingDoodlePen";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { grammarPoints } from "../data/grammar";
import { getGrammarPointFavorite, toggleFavorite } from "../lib/api";
import { getGrammarNote, setGrammarNote } from "../lib/grammarNotes";
import { GrammarPoint, JLPTLevel, MasteryStatus } from "../types/grammar";

interface LibraryProps {
  getMastery: (id: string) => MasteryStatus;
  onMarkLearned: (id: string) => void;
  onMarkForgot: (id: string) => void;
  selectedLevel: "All" | JLPTLevel;
  onSelectedLevelChange: (level: "All" | JLPTLevel) => void;
  onOpenFavorites: () => void;
  onOpenImmersive: () => void;
  onOpenDetail: (id: string) => void;
}

const levels: ("All" | JLPTLevel)[] = ["All", "N5", "N4", "N3", "N2", "N1"];
const ORDER_KEY = "jp-grammar-card-order-v2";

// 必须与 tailwind.config.js 的 `twopane` 屏幕断点完全一致：
// 只有宽到能并排显示「左列表 / 右详情」时才用内联双栏，
// 否则（手机竖屏等）点卡片改为打开整页详情。
const TWO_PANE_QUERY =
  "(min-width: 1024px), (orientation: landscape) and (min-width: 700px) and (max-height: 600px)";

const statusLabel: Record<MasteryStatus, string> = {
  new: "未学",
  learning: "学习中",
  familiar: "熟悉",
  mastered: "掌握"
};

const readOrder = () => {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

const moveId = (ids: string[], id: string, direction: "front" | "back") => {
  const without = ids.filter((item) => item !== id);
  return direction === "front" ? [id, ...without] : [...without, id];
};

const pointIndex = new Map(grammarPoints.map((point, index) => [point.id, index]));

const GrammarExplanation = ({
  point,
  mastery,
  isFavorite,
  onRemember,
  onForget,
  onToggleFavorite,
  note,
  noteDraft,
  noteEditorOpen,
  onOpenNote,
  onCancelNote,
  onChangeNote,
  onSaveNote
}: {
  point: GrammarPoint;
  mastery: MasteryStatus;
  isFavorite: boolean;
  onRemember: () => void;
  onForget: () => void;
  onToggleFavorite: () => void;
  note: string;
  noteDraft: string;
  noteEditorOpen: boolean;
  onOpenNote: () => void;
  onCancelNote: () => void;
  onChangeNote: (value: string) => void;
  onSaveNote: () => void;
}) => (
  <section className="dictionary-card sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-2xl p-5 relative">
    <div className="border-b border-white/15 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{point.level}</span>
        <span className="rounded-sm bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-white/80">{statusLabel[mastery]}</span>
        <button
          onClick={onToggleFavorite}
          className={`focus-ring ml-auto grid h-9 w-9 place-items-center rounded-2xl border border-white/20 ${isFavorite ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/72"}`}
          title={isFavorite ? "取消收藏" : "收藏语法"}
        >
          <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        <button
          onClick={onOpenNote}
          className={`focus-ring grid h-9 w-9 place-items-center rounded-2xl border border-white/20 ${note ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/72"}`}
          title={note ? "编辑备注" : "添加备注"}
        >
          <StickyNote size={16} />
        </button>
      </div>
      <h2 className="jp-serif mt-4 text-5xl font-semibold leading-none"><JapaneseRuby text={point.title} /></h2>
      <p className="mt-4 text-xl leading-8 text-white/86">{point.meaning}</p>
      <p className="jp mt-4 rounded-2xl border border-white/15 bg-[#373b3b] px-3 py-2 text-sm leading-7 text-white/78">
        <GrammarTermHint text={point.connection ?? point.structure} />
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={onForget}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-[#81D8CF]/10 text-sm font-bold hover:bg-[#81D8CF]/15"
        >
          <XCircle size={16} />
          没记住
        </button>
        <button
          onClick={onRemember}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] text-sm font-bold !text-[#343838]"
        >
          <CheckCircle2 size={16} />
          熟悉
        </button>
      </div>
      {(note || noteEditorOpen) && (
        <div className="mt-4 rounded-2xl border border-white/15 bg-[#373b3b] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">My Note</p>
            {noteEditorOpen && (
              <button onClick={onCancelNote} className="focus-ring grid h-7 w-7 place-items-center rounded-xl border border-white/15 bg-white/5" title="关闭备注">
                <X size={14} />
              </button>
            )}
          </div>
          {noteEditorOpen ? (
            <div className="space-y-2">
              <textarea
                value={noteDraft}
                onChange={(event) => onChangeNote(event.target.value)}
                className="min-h-24 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
                placeholder="写下这条语法自己的记忆点、误区或例句..."
              />
              <button onClick={onSaveNote} className="focus-ring w-full rounded-2xl bg-[#81D8CF] px-3 py-2 text-sm font-bold !text-[#343838]">
                保存备注
              </button>
            </div>
          ) : (
            <button onClick={onOpenNote} className="focus-ring block w-full whitespace-pre-wrap text-left text-sm leading-6 text-white/76">
              {note}
            </button>
          )}
        </div>
      )}
    </div>

    <div className="space-y-5 pt-5">
      <section>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Explanation</p>
        <p className="mt-3 text-[15px] leading-8 text-white/78">{point.explanation}</p>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Examples</p>
        <div className="mt-3 space-y-3">
          {point.examples.slice(0, 4).map((example) => (
            <article key={example.jp ?? example.japanese} className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
              <p className="jp text-lg leading-8"><JapaneseRuby text={example.jp ?? example.japanese} /></p>
              <p className="mt-1 text-sm leading-6 text-white/60">{example.reading}</p>
              <p className="mt-2 text-sm leading-6 text-white/76">{example.cn ?? example.chinese}</p>
            </article>
          ))}
        </div>
      </section>

    </div>
  </section>
);

export const Library = ({
  getMastery,
  onMarkLearned,
  onMarkForgot,
  selectedLevel,
  onSelectedLevelChange,
  onOpenFavorites,
  onOpenImmersive,
  onOpenDetail
}: LibraryProps) => {
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(grammarPoints[0]?.id ?? "");
  const [isTwoPane, setIsTwoPane] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TWO_PANE_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(TWO_PANE_QUERY);
    const handler = () => setIsTwoPane(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // 卡片主体点击：宽屏 → 更新右侧内联详情；窄屏 → 打开整页详情。
  const openCard = (id: string) => {
    if (isTwoPane) {
      setSelectedId(id);
    } else {
      onOpenDetail(id);
    }
  };
  const [cardOrder, setCardOrder] = useState<string[]>(readOrder);
  const [, setFavoriteVersion] = useState(0);
  const [noteEditorId, setNoteEditorId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [, setNoteVersion] = useState(0);

  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(cardOrder));
  }, [cardOrder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const orderRank = new Map(cardOrder.map((id, index) => [id, index]));
    return grammarPoints
      .filter((point) => {
        const matchesLevel = selectedLevel === "All" || point.level === selectedLevel;
        const haystack = `${point.title} ${point.meaning} ${point.structure} ${point.explanation}`.toLowerCase();
        return matchesLevel && (!q || haystack.includes(q));
      })
      .sort((left, right) => {
        const leftRank = orderRank.get(left.id) ?? (pointIndex.get(left.id) ?? 0) + 100000;
        const rightRank = orderRank.get(right.id) ?? (pointIndex.get(right.id) ?? 0) + 100000;
        return leftRank - rightRank;
      });
  }, [cardOrder, query, selectedLevel]);

  const selected = filtered.find((point) => point.id === selectedId) ?? filtered[0] ?? grammarPoints[0];

  useEffect(() => {
    if (selected && !filtered.some((point) => point.id === selectedId)) {
      setSelectedId(selected.id);
    }
  }, [filtered, selected, selectedId]);

  const reorder = (id: string, direction: "front" | "back") => {
    setCardOrder((current) => {
      const merged = [...current, ...grammarPoints.map((point) => point.id)].filter((item, index, arr) => arr.indexOf(item) === index);
      return moveId(merged, id, direction);
    });
  };

  const remember = (id: string) => {
    onMarkLearned(id);
    reorder(id, "back");
    const next = filtered.find((point) => point.id !== id) ?? selected;
    setSelectedId(next.id);
  };

  const forget = (id: string) => {
    onMarkForgot(id);
    reorder(id, "front");
    setSelectedId(id);
  };

  const isGrammarFavorite = (id: string) => {
    return getGrammarPointFavorite(id);
  };

  const toggleGrammarFavorite = (id: string) => {
    toggleFavorite("grammar", id);
    setFavoriteVersion((value) => value + 1);
  };

  const grammarNote = (id: string) => {
    return getGrammarNote(id);
  };

  const openNoteEditor = (id: string) => {
    setSelectedId(id);
    setNoteEditorId(id);
    setNoteDraft(getGrammarNote(id));
  };

  const saveNote = () => {
    if (!noteEditorId) return;
    setGrammarNote(noteEditorId, noteDraft);
    setNoteVersion((value) => value + 1);
    setNoteEditorId("");
    setNoteDraft("");
  };

  return (
    <>
      <FloatingDoodlePen resetKey={selectedLevel} surfaceSelector='[data-doodle-surface="grammar-page"]' />
      <div data-doodle-surface="grammar-page" className="relative grid gap-5 twopane:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="min-w-0 space-y-4">
        <div className="dictionary-card rounded-2xl p-4">
          <div className="space-y-2">
            <label className="focus-ring control-cyan control-cyan-search soft-text-outline min-w-0 flex-1 rounded-2xl border px-3 py-2.5">
              <Search className="control-cyan-icon shrink-0" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="control-cyan-search-input text-sm font-semibold"
                placeholder="搜索语法、接续、含义"
              />
            </label>
            <div className="grid grid-cols-[minmax(82px,1fr)_minmax(96px,1fr)_minmax(68px,0.8fr)] gap-2">
              <div className="relative min-w-0">
                <button
                  onClick={() => setFilterOpen((value) => !value)}
                  className="focus-ring control-cyan soft-text-outline inline-flex h-8 w-full items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold"
              >
                  <span className="truncate">{selectedLevel === "All" ? "全部等级" : selectedLevel}</span>
                  <ChevronDown size={13} />
                </button>
                {filterOpen && (
                  <div className="absolute left-0 top-10 z-20 grid w-44 grid-cols-2 gap-2 rounded-2xl border border-white/20 bg-[#373b3b] p-3 shadow-lg">
                    {levels.map((level) => (
                      <button
                        key={level}
                        onClick={() => {
                          onSelectedLevelChange(level);
                          setFilterOpen(false);
                        }}
                        className={`focus-ring rounded-2xl border px-3 py-2 text-sm font-bold ${
                          selectedLevel === level
                            ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]"
                            : "border-white/15 bg-[#81D8CF]/10 text-white/78 hover:bg-[#81D8CF]/15"
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={onOpenImmersive}
                className="focus-ring inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-xl border border-white/20 bg-[#81D8CF]/10 px-2 text-xs font-bold text-white/78 hover:bg-[#81D8CF]/15"
              >
                <Layers size={13} />
                <span className="truncate">沉浸学习</span>
              </button>
              <button
                onClick={onOpenFavorites}
                className="focus-ring inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-xl border border-white/20 bg-[#81D8CF]/10 px-2 text-xs font-bold text-white/78 hover:bg-[#81D8CF]/15"
              >
                <Star size={13} />
                <span className="truncate">收藏</span>
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/55">{filtered.length} 张语法卡片</p>
        </div>

        <div className="grid gap-3">
          {filtered.map((point) => {
            const mastery = getMastery(point.id);
            const active = point.id === selected.id;
            const note = grammarNote(point.id);
            return (
              <article
                key={point.id}
                className={`grammar-anki-card rounded-2xl p-4 transition ${
                  active ? "grammar-anki-card-active" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <button onClick={() => openCard(point.id)} className="focus-ring min-w-0 flex-1 text-left">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{point.level}</span>
                        <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/65">{statusLabel[mastery]}</span>
                      </div>
                      <h3 className="jp-serif mt-3 text-3xl font-semibold leading-none"><JapaneseRuby text={point.title} /></h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-white/82">{point.meaning}</p>
                    </div>
                    <p className="jp mt-3 rounded-2xl border border-white/10 bg-[#373b3b] px-3 py-2 text-sm leading-6 text-white/65">
                      <JapaneseRuby text={point.connection ?? point.structure} />
                    </p>
                  </button>
                  <div className="grid shrink-0 gap-2">
                    <button
                      onClick={() => toggleGrammarFavorite(point.id)}
                      className={`focus-ring grid h-8 w-8 place-items-center rounded-2xl border border-white/20 ${isGrammarFavorite(point.id) ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/65"}`}
                      title={isGrammarFavorite(point.id) ? "取消收藏" : "收藏语法"}
                    >
                      <Star size={14} fill={isGrammarFavorite(point.id) ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={() => openNoteEditor(point.id)}
                      className={`focus-ring grid h-8 w-8 place-items-center rounded-2xl border border-white/20 ${note ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/65"}`}
                      title={note ? "编辑备注" : "添加备注"}
                    >
                      <StickyNote size={14} />
                    </button>
                  </div>
                </div>
                {note && noteEditorId !== point.id && (
                  <button
                    onClick={() => openNoteEditor(point.id)}
                    className="focus-ring mt-3 block w-full truncate rounded-2xl border border-white/10 bg-[#81D8CF]/10 px-3 py-2 text-left text-xs font-semibold text-white/70"
                  >
                    备注：{note}
                  </button>
                )}
                {noteEditorId === point.id && (
                  <div className="mt-3 rounded-2xl border border-white/15 bg-[#373b3b] p-3">
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="min-h-24 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
                      placeholder="写下这条语法自己的记忆点、误区或例句..."
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setNoteEditorId("");
                          setNoteDraft("");
                        }}
                        className="focus-ring rounded-2xl border border-white/20 px-3 py-2 text-sm font-bold text-white/70 hover:bg-white/8"
                      >
                        取消
                      </button>
                      <button onClick={saveNote} className="focus-ring rounded-2xl bg-[#81D8CF] px-3 py-2 text-sm font-bold !text-[#343838]">
                        保存
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => forget(point.id)}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-[#81D8CF]/10 text-sm font-bold hover:bg-[#81D8CF]/15"
                  >
                    <XCircle size={15} />
                    没记住
                  </button>
                  <button
                    onClick={() => remember(point.id)}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] text-sm font-bold !text-[#343838]"
                  >
                    <CheckCircle2 size={15} />
                    熟悉
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        </section>

        {isTwoPane && selected && (
          <GrammarExplanation
            point={selected}
            mastery={getMastery(selected.id)}
            isFavorite={isGrammarFavorite(selected.id)}
            note={grammarNote(selected.id)}
            noteDraft={noteEditorId === selected.id ? noteDraft : grammarNote(selected.id)}
            noteEditorOpen={noteEditorId === selected.id}
            onRemember={() => remember(selected.id)}
            onForget={() => forget(selected.id)}
            onToggleFavorite={() => toggleGrammarFavorite(selected.id)}
            onOpenNote={() => openNoteEditor(selected.id)}
            onCancelNote={() => {
              setNoteEditorId("");
              setNoteDraft("");
            }}
            onChangeNote={setNoteDraft}
            onSaveNote={saveNote}
          />
        )}
      </div>
    </>
  );
};
