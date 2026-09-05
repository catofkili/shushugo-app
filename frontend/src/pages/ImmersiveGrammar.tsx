import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Star, StickyNote, X } from "lucide-react";
import { FloatingDoodlePen } from "../components/FloatingDoodlePen";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { grammarPoints } from "../data/grammar";
import { addFavorite, getGrammarPointFavorite, toggleFavorite } from "../lib/api";
import { useFavoriteFolderPicker } from "../components/FavoriteFolderPicker";
import { getGrammarNote, setGrammarNote } from "../lib/grammarNotes";
import { grammarSequence } from "../lib/grammar-numbering";
import { getGrammarPosition, saveGrammarPosition } from "../lib/grammarProgressPreferences";
import { getGrammarTitleFurigana } from "../lib/grammar-title-furigana";
import { JLPTLevel } from "../types/grammar";

interface ImmersiveGrammarProps {
  selectedLevel: "All" | JLPTLevel;
  onBack: () => void;
  onOpenFavorites: () => void;
  onMarkLearned: (id: string) => void;
}

export const ImmersiveGrammar = ({ selectedLevel, onBack, onOpenFavorites, onMarkLearned }: ImmersiveGrammarProps) => {
  const points = useMemo(() => (
    grammarPoints.filter((point) => selectedLevel === "All" || point.level === selectedLevel)
  ), [selectedLevel]);
  const [pointId, setPointId] = useState(() => {
    const saved = getGrammarPosition("immersive", selectedLevel);
    return typeof saved === "string" ? saved : points[0]?.id ?? "";
  });
  const [, setFavoriteVersion] = useState(0);
  const { pickFolder, picker } = useFavoriteFolderPicker();
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [, setNoteVersion] = useState(0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const savedIndex = points.findIndex((item) => item.id === pointId);
  const index = savedIndex >= 0 ? savedIndex : 0;
  const point = points[index];
  const sequence = point ? grammarSequence(point) : null;
  const favorite = point ? getGrammarPointFavorite(point.id) : false;
  const note = point ? getGrammarNote(point.id) : "";

  useEffect(() => {
    if (point) saveGrammarPosition("immersive", selectedLevel, point.id);
  }, [point?.id, selectedLevel]);

  useEffect(() => {
    setNoteEditorOpen(false);
    setNoteDraft(point ? getGrammarNote(point.id) : "");
  }, [point?.id]);

  const scrollToCardTop = () => {
    requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const move = (direction: -1 | 1) => {
    const nextIndex = Math.min(Math.max(index + direction, 0), Math.max(points.length - 1, 0));
    if (points[nextIndex]) setPointId(points[nextIndex].id);
    scrollToCardTop();
  };

  if (!point) {
    return (
      <section className="dictionary-card mx-auto max-w-3xl rounded-2xl p-8 text-center">
        <p className="text-lg font-bold">这个等级暂时没有语法</p>
        <button onClick={onBack} className="focus-ring mt-4 rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#343838]">返回</button>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="mx-auto flex min-h-[560px] max-w-4xl flex-col gap-4">
      <FloatingDoodlePen resetKey={point.id} surfaceSelector='[data-doodle-surface="immersive-card"]' />
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8">
          <ArrowLeft size={17} />
          语法
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <p className="truncate text-sm font-bold text-white/65">{sequence?.label} · {sequence?.ordinal}/{sequence?.total}</p>
          <button
            onClick={() => move(1)}
            disabled={index >= points.length - 1}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/15 bg-[#81D8CF]/12 px-2.5 py-1.5 text-xs font-bold text-white/82 disabled:opacity-40"
          >
            下一个
            <ChevronRight size={14} />
          </button>
        </div>
        <button onClick={onOpenFavorites} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold text-white/78 hover:bg-white/8">
          <Star size={16} />
          收藏
        </button>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[#81D8CF]/15">
        <div className="h-full rounded-full bg-[#81D8CF]" style={{ width: `${((index + 1) / points.length) * 100}%` }} />
      </div>

      <article data-grammar-point-id={point.id} className="dictionary-card flex min-h-0 flex-1 flex-col rounded-2xl p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3 border-b border-white/15 pb-4">
          <div className="min-w-0">
            <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/62">{sequence?.label}</span>
            <h1 data-grammar-point-id={point.id} data-grammar-highlight-block="title" className="jp-serif mt-4 text-5xl font-semibold leading-tight"><JapaneseRuby text={point.title} furigana={getGrammarTitleFurigana(point.id)} /></h1>
            <p data-grammar-point-id={point.id} data-grammar-highlight-block="meaning" className="mt-3 text-xl leading-8 text-white/82">{point.meaning}</p>
          </div>
          <button
            onClick={() => {
              if (favorite) {
                toggleFavorite("grammar", point.id);
                setFavoriteVersion((value) => value + 1);
                return;
              }
              pickFolder({
                title: `收藏「${point.title}」到`,
                onPick: (folder) => {
                  addFavorite("grammar", point.id, folder);
                  setFavoriteVersion((value) => value + 1);
                }
              });
            }}
            className={`focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/20 ${favorite ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/72"}`}
            title={favorite ? "取消收藏" : "收藏语法"}
          >
            <Star size={17} fill={favorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => {
              setNoteDraft(getGrammarNote(point.id));
              setNoteEditorOpen(true);
            }}
            className={`focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/20 ${note ? "bg-[#81D8CF] !text-[#343838]" : "bg-[#81D8CF]/10 text-white/72"}`}
            title={note ? "编辑备注" : "添加备注"}
          >
            <StickyNote size={17} />
          </button>
        </div>

        <div ref={contentRef} data-doodle-surface="immersive-card" className="relative min-h-0 flex-1 overflow-y-auto py-5">
          {(note || noteEditorOpen) && (
            <div className="mb-5 rounded-2xl border border-white/15 bg-[#373b3b] p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">My Note</p>
                {noteEditorOpen && (
                  <button onClick={() => setNoteEditorOpen(false)} className="focus-ring grid h-7 w-7 place-items-center rounded-xl border border-white/15 bg-white/5" title="关闭备注">
                    <X size={14} />
                  </button>
                )}
              </div>
              {noteEditorOpen ? (
                <div className="space-y-2">
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    className="min-h-24 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
                    placeholder="写下这条语法自己的记忆点、误区或例句..."
                  />
                  <button
                    onClick={() => {
                      setGrammarNote(point.id, noteDraft);
                      setNoteVersion((value) => value + 1);
                      setNoteEditorOpen(false);
                    }}
                    className="focus-ring w-full rounded-2xl bg-[#81D8CF] px-3 py-2 text-sm font-bold !text-[#343838]"
                  >
                    保存备注
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setNoteDraft(note);
                    setNoteEditorOpen(true);
                  }}
                  className="focus-ring block w-full whitespace-pre-wrap text-left text-sm leading-6 text-white/76"
                >
                  {note}
                </button>
              )}
            </div>
          )}
          <p data-grammar-point-id={point.id} data-grammar-highlight-block="formation" className="jp rounded-2xl border border-white/15 bg-[#373b3b] px-4 py-3 text-lg leading-8 text-white/82">
            <GrammarTermHint text={point.connection ?? point.structure} />
          </p>
          <p data-grammar-point-id={point.id} data-grammar-highlight-block="explanation" className="mt-5 text-[15px] leading-8 text-white/76">{point.explanation}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {point.examples.slice(0, 4).map((example, exampleIndex) => (
              <div key={example.jp ?? example.japanese} data-grammar-point-id={point.id} data-grammar-highlight-block={`immersive-example-${exampleIndex}`} className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
                <p className="jp text-lg leading-8"><JapaneseRuby text={example.jp ?? example.japanese} furigana={example.furigana} tokenLengths={example.tokenLengths} tokenLemmas={example.tokenLemmas} grammarPoint={point} /></p>
                <p className="mt-2 text-sm leading-6 text-white/62">{example.cn ?? example.chinese}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[52px_1fr_52px] gap-3">
          <button onClick={() => move(-1)} disabled={index === 0} className="focus-ring grid h-14 place-items-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 disabled:opacity-40">
            <ChevronLeft size={20} />
          </button>
          <button onClick={() => onMarkLearned(point.id)} className="focus-ring inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] text-sm font-bold !text-[#343838]">
            <CheckCircle2 size={17} />
            标记熟悉
          </button>
          <button onClick={() => move(1)} disabled={index >= points.length - 1} className="focus-ring grid h-14 place-items-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 disabled:opacity-40">
            <ChevronRight size={20} />
          </button>
        </div>
      </article>
      {picker}
    </section>
  );
};
