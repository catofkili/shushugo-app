import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Layers, PenLine, Search, Star, StickyNote, X, XCircle } from "lucide-react";
import { FloatingDoodlePen } from "../components/FloatingDoodlePen";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { grammarPoints } from "../data/grammar";
import { splitFormationRules } from "../lib/grammar-formation";
import { addFavorite, getGrammarPointFavorite, toggleFavorite } from "../lib/api";
import { useFavoriteFolderPicker } from "../components/FavoriteFolderPicker";
import { getGrammarNote, setGrammarNote } from "../lib/grammarNotes";
import { grammarSequence } from "../lib/grammar-numbering";
import {
  getGrammarPosition,
  getGrammarScrollPosition,
  saveGrammarPosition,
  saveGrammarScrollPosition,
  GRAMMAR_POSITIONS_UPDATED_EVENT
} from "../lib/grammarProgressPreferences";
import { getGrammarTitleFurigana } from "../lib/grammar-title-furigana";
import { GrammarPoint, JLPTLevel, MasteryStatus } from "../types/grammar";

interface LibraryProps {
  getMastery: (id: string) => MasteryStatus;
  onMarkLearned: (id: string) => void;
  onMarkForgot: (id: string) => void;
  selectedLevel: "All" | JLPTLevel;
  onSelectedLevelChange: (level: "All" | JLPTLevel) => void;
  onOpenFavorites: () => void;
  onOpenImmersive: () => void;
  onOpenQuiz: () => void;
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
  <section data-grammar-point-id={point.id} className="dictionary-card sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-2xl p-5 relative">
    <div className="border-b border-white/15 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{grammarSequence(point).label}</span>
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
      <h2 data-grammar-point-id={point.id} data-grammar-highlight-block="title" className="jp-serif mt-4 text-5xl font-semibold leading-none"><JapaneseRuby text={point.title} furigana={getGrammarTitleFurigana(point.id)} /></h2>
      <p data-grammar-point-id={point.id} data-grammar-highlight-block="meaning" className="mt-4 text-xl leading-8 text-white/86">{point.meaning}</p>
      <p data-grammar-point-id={point.id} data-grammar-highlight-block="formation" className="jp mt-4 rounded-2xl border border-white/15 bg-[#373b3b] px-3 py-2 text-sm leading-7 text-white/78">
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
        <p data-grammar-point-id={point.id} data-grammar-highlight-block="explanation" className="mt-3 text-[15px] leading-8 text-white/78">{point.explanation}</p>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Examples</p>
        <div className="mt-3 space-y-3">
          {point.examples.slice(0, 4).map((example, exampleIndex) => (
            <article key={example.jp ?? example.japanese} data-grammar-point-id={point.id} data-grammar-highlight-block={`library-example-${exampleIndex}`} className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
              <p className="jp text-lg leading-8"><JapaneseRuby text={example.jp ?? example.japanese} furigana={example.furigana} tokenLengths={example.tokenLengths} tokenLemmas={example.tokenLemmas} grammarPoint={point} /></p>
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
  onOpenQuiz,
  onOpenDetail
}: LibraryProps) => {
  const { pickFolder, picker } = useFavoriteFolderPicker();
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIdsByLevel, setSelectedIdsByLevel] = useState<Record<string, string>>({});
  const [, setPositionRevision] = useState(0);
  const [isTwoPane, setIsTwoPane] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TWO_PANE_QUERY).matches
  );

  const storedSelectedId = selectedIdsByLevel[selectedLevel] ?? getGrammarPosition("library", selectedLevel);
  const selectedId = typeof storedSelectedId === "string" ? storedSelectedId : "";
  const rememberSelection = (id: string) => {
    setSelectedIdsByLevel((current) => current[selectedLevel] === id ? current : { ...current, [selectedLevel]: id });
    saveGrammarPosition("library", selectedLevel, id);
  };

  const mainScrollContainer = () => document.querySelector<HTMLElement>("main.app-landscape-main");
  const rememberScroll = () => {
    const container = mainScrollContainer();
    if (container) saveGrammarScrollPosition("library", selectedLevel, container.scrollTop);
  };

  // Library 在移动端打开详情后会卸载，详情页较短会把 main 的 scrollTop 压成 0。
  // 下一次挂载时等列表 DOM 完成，再恢复该等级上一次保存的滚动位置。
  useLayoutEffect(() => {
    const container = mainScrollContainer();
    const saved = getGrammarScrollPosition("library", selectedLevel);
    if (!container || saved === undefined) return;
    const restore = () => {
      container.scrollTop = saved;
      const selectedCard = [...container.querySelectorAll<HTMLElement>(".grammar-anki-card[data-grammar-point-id]")]
        .find((card) => card.dataset.grammarPointId === selectedId);
      if (!selectedCard) return;
      const containerRect = container.getBoundingClientRect();
      const cardRect = selectedCard.getBoundingClientRect();
      if (cardRect.top < containerRect.top || cardRect.bottom > containerRect.bottom) {
        selectedCard.scrollIntoView({ block: "center", behavior: "auto" });
      }
    };
    restore();
    const frame = window.requestAnimationFrame(() => {
      restore();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, selectedLevel]);

  useEffect(() => {
    const refreshPosition = () => setPositionRevision((value) => value + 1);
    window.addEventListener(GRAMMAR_POSITIONS_UPDATED_EVENT, refreshPosition);
    return () => window.removeEventListener(GRAMMAR_POSITIONS_UPDATED_EVENT, refreshPosition);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(TWO_PANE_QUERY);
    const handler = () => setIsTwoPane(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // 卡片主体点击：宽屏 → 更新右侧内联详情；窄屏 → 打开整页详情。
  const openCard = (id: string) => {
    rememberSelection(id);
    rememberScroll();
    if (!isTwoPane) onOpenDetail(id);
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
    rememberSelection(next.id);
  };

  const forget = (id: string) => {
    onMarkForgot(id);
    reorder(id, "front");
    rememberSelection(id);
  };

  const isGrammarFavorite = (id: string) => {
    return getGrammarPointFavorite(id);
  };

  const toggleGrammarFavorite = (id: string, label: string) => {
    if (getGrammarPointFavorite(id)) {
      toggleFavorite("grammar", id);
      setFavoriteVersion((value) => value + 1);
      return;
    }
    pickFolder({
      title: `收藏「${label}」到`,
      onPick: (folder) => {
        addFavorite("grammar", id, folder);
        setFavoriteVersion((value) => value + 1);
      }
    });
  };

  const grammarNote = (id: string) => {
    return getGrammarNote(id);
  };

  const openNoteEditor = (id: string) => {
    rememberSelection(id);
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
                          rememberScroll();
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
              {/* 考题：题面给句型、答案给接续+中文意。和沉浸学习并排,都是「换一种过法」。 */}
              <button
                onClick={onOpenQuiz}
                className="focus-ring inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-xl border border-white/20 bg-[#81D8CF]/10 px-2 text-xs font-bold text-white/78 hover:bg-[#81D8CF]/15"
              >
                <PenLine size={13} />
                <span className="truncate">考题</span>
              </button>
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
            const firstExample = point.examples[0];
            const formationRules = splitFormationRules(point.connection ?? point.structure);
            return (
              <article
                key={point.id}
                data-grammar-point-id={point.id}
                className={`grammar-anki-card rounded-2xl p-4 transition ${
                  active ? "grammar-anki-card-active" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <button onClick={() => openCard(point.id)} className="focus-ring min-w-0 flex-1 text-left">
                    <div className="min-w-0">
                      {/* 等级/序号和状态靠右：它们是「这是第几条」，不是这张卡的主语。
                          左边空出来给接续 —— 接续读起来就在句型前面（「辞书形＋」），
                          摆在标题正上方才顺，摆右上角就得斜着看。 */}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{grammarSequence(point).label}</span>
                        <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/65">{statusLabel[mastery]}</span>
                      </div>
                      {formationRules[0] && (
                        <p className="jp mt-2 text-xs font-semibold leading-5 text-white/45">{formationRules[0]}</p>
                      )}
                      <h3 data-grammar-point-id={point.id} data-grammar-highlight-block="title" className="jp-serif mt-1 text-3xl font-semibold leading-none"><JapaneseRuby text={point.title} furigana={getGrammarTitleFurigana(point.id)} /></h3>
                      <p data-grammar-point-id={point.id} data-grammar-highlight-block="meaning" className="mt-2 text-sm font-semibold leading-6 text-white/82">{point.meaning}</p>
                      {/* 第二条接续摆正下方，和上面那条一上一下对着看 ——
                          只有真的分两条规则的卡才有（55/731），见 splitFormationRules。 */}
                      {formationRules[1] && (
                        <p className="jp mt-2 text-xs font-semibold leading-5 text-white/45">{formationRules[1]}</p>
                      )}
                    </div>
                    {firstExample && (
                      <div data-grammar-point-id={point.id} data-grammar-highlight-block="card-example-0" className="mt-3 rounded-2xl border border-white/10 bg-[#373b3b] px-3 py-2 text-sm leading-6 text-white/65">
                        <p className="jp"><JapaneseRuby text={firstExample.jp ?? firstExample.japanese} furigana={firstExample.furigana} tokenLengths={firstExample.tokenLengths} tokenLemmas={firstExample.tokenLemmas} /></p>
                        <p className="mt-1 text-xs leading-5 text-white/55">{firstExample.cn ?? firstExample.chinese}</p>
                      </div>
                    )}
                  </button>
                  <div className="grid shrink-0 gap-2">
                    <button
                      onClick={() => toggleGrammarFavorite(point.id, point.title)}
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
            onToggleFavorite={() => toggleGrammarFavorite(selected.id, selected.title)}
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
      {picker}
    </>
  );
};
