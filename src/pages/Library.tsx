import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Search, StickyNote, X, XCircle } from "lucide-react";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { grammarPoints } from "../data/grammar";
import { getGrammarNote, setGrammarNote } from "../lib/grammarNotes";
import { GrammarPoint, JLPTLevel, MasteryStatus } from "../types/grammar";

interface LibraryProps {
  getMastery: (id: string) => MasteryStatus;
  onMarkLearned: (id: string) => void;
  onMarkForgot: (id: string) => void;
  selectedLevel: "All" | JLPTLevel;
  onSelectedLevelChange: (level: "All" | JLPTLevel) => void;
}

const levels: ("All" | JLPTLevel)[] = ["All", "N5", "N4", "N3", "N2", "N1"];
const ORDER_KEY = "jp-grammar-card-order-v2";

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
  onRemember,
  onForget,
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
  onRemember: () => void;
  onForget: () => void;
  note: string;
  noteDraft: string;
  noteEditorOpen: boolean;
  onOpenNote: () => void;
  onCancelNote: () => void;
  onChangeNote: (value: string) => void;
  onSaveNote: () => void;
}) => (
  <section className="dictionary-card sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-md p-5">
    <div className="border-b border-white/15 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{point.level}</span>
        <span className="rounded-sm bg-[#81D8CF]/15 px-2 py-1 text-xs font-bold text-white/80">{statusLabel[mastery]}</span>
        <button
          onClick={onOpenNote}
          className={`focus-ring ml-auto grid h-9 w-9 place-items-center rounded-md border border-white/20 ${note ? "bg-[#81D8CF] !text-[#343838]" : "bg-white/5 text-white/72"}`}
          title={note ? "编辑备注" : "添加备注"}
        >
          <StickyNote size={16} />
        </button>
      </div>
      <h2 className="jp-serif mt-4 text-5xl font-semibold leading-tight">
        <JapaneseRuby text={point.title} />
      </h2>
      <p className="mt-4 text-xl leading-8 text-white/86">{point.meaning}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={onForget}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 text-sm font-bold hover:bg-white/10"
        >
          <XCircle size={16} />
          没记住
        </button>
        <button
          onClick={onRemember}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#81D8CF] text-sm font-bold !text-[#343838]"
        >
          <CheckCircle2 size={16} />
          熟悉
        </button>
      </div>
      {(note || noteEditorOpen) && (
        <div className="mt-4 rounded-md border border-white/15 bg-[#373b3b] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">My Note</p>
            {noteEditorOpen && (
              <button onClick={onCancelNote} className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-white/5" title="关闭备注">
                <X size={14} />
              </button>
            )}
          </div>
          {noteEditorOpen ? (
            <div className="space-y-2">
              <textarea
                value={noteDraft}
                onChange={(event) => onChangeNote(event.target.value)}
                className="min-h-24 w-full resize-none rounded-md border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
                placeholder="写下这条语法自己的记忆点、误区或例句..."
              />
              <button onClick={onSaveNote} className="focus-ring w-full rounded-md bg-[#81D8CF] px-3 py-2 text-sm font-bold !text-[#343838]">
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
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">接续</p>
        <p className="jp mt-3 rounded-md border border-white/15 bg-[#373b3b] px-3 py-2 text-[15px] leading-8 text-white/86">
          <GrammarTermHint text={point.connection ?? point.structure} />
        </p>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">注意</p>
        <div className="mt-3 space-y-2 text-[15px] leading-8 text-white/78">
          {(point.usageNotes?.length ? point.usageNotes : [point.explanation]).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">例句</p>
        <div className="mt-3 space-y-3">
          {point.examples.map((example) => (
            <article key={example.japanese} className="rounded-md border border-white/15 bg-[#373b3b] p-4">
              <p className="jp text-lg leading-8"><JapaneseRuby text={example.japanese} /></p>
              <p className="mt-1 text-sm leading-6 text-white/60">{example.reading}</p>
              <p className="mt-2 text-sm leading-6 text-white/76">{example.chinese}</p>
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
  onSelectedLevelChange
}: LibraryProps) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(grammarPoints[0]?.id ?? "");
  const [cardOrder, setCardOrder] = useState<string[]>(readOrder);
  const [noteEditorId, setNoteEditorId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteVersion, setNoteVersion] = useState(0);

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

  const grammarNote = (id: string) => {
    noteVersion;
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
    <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)]">
      <section className="min-w-0 space-y-4">
        <div className="dictionary-card rounded-md p-4">
          <div className="flex flex-col gap-3">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-3 text-white/50" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="focus-ring w-full rounded-md border border-white/20 bg-[#3c3f3f] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/60"
                placeholder="搜索语法、接续、含义"
              />
            </label>
            {/* 常驻分段按钮：始终可见的 N1-N5 等级筛选 */}
            <div className="flex flex-wrap gap-2">
              {levels.map((level) => (
                <button
                  key={level}
                  onClick={() => onSelectedLevelChange(level)}
                  aria-pressed={selectedLevel === level}
                  className={`focus-ring rounded-md border px-3 py-1.5 text-sm font-bold transition ${
                    selectedLevel === level
                      ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]"
                      : "border-white/15 bg-white/5 text-white/78 hover:bg-white/10"
                  }`}
                >
                  {level === "All" ? "全部" : level}
                </button>
              ))}
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
                className={`dictionary-card rounded-md p-4 transition ${
                  active ? "border-[#81D8CF] bg-[#3f4343]" : "hover:border-white/35"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button onClick={() => setSelectedId(point.id)} className="focus-ring min-w-0 flex-1 text-left">
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{point.level}</span>
                      <span className="rounded-sm bg-white/5 px-2 py-1 text-xs font-bold text-white/65">{statusLabel[mastery]}</span>
                    </div>
                    <h3 className="jp-serif mt-3 text-3xl font-semibold leading-tight"><JapaneseRuby text={point.title} /></h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-white/82">{point.meaning}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => openNoteEditor(point.id)}
                    className={`focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/20 ${note ? "bg-[#81D8CF] !text-[#343838]" : "bg-white/5 text-white/65"}`}
                    title={note ? "编辑备注" : "添加备注"}
                  >
                    <StickyNote size={14} />
                  </button>
                </div>
                <button onClick={() => setSelectedId(point.id)} className="focus-ring block w-full text-left">
                  <p className="jp mt-3 rounded-md border border-white/10 bg-[#373b3b] px-3 py-2 text-sm leading-6 text-white/65">
                    {point.connection ?? point.structure}
                  </p>
                </button>
                {note && noteEditorId !== point.id && (
                  <button
                    onClick={() => openNoteEditor(point.id)}
                    className="focus-ring mt-3 block w-full truncate rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-semibold text-white/70"
                  >
                    备注：{note}
                  </button>
                )}
                {noteEditorId === point.id && (
                  <div className="mt-3 rounded-md border border-white/15 bg-[#373b3b] p-3">
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="min-h-24 w-full resize-none rounded-md border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
                      placeholder="写下这条语法自己的记忆点、误区或例句..."
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setNoteEditorId("");
                          setNoteDraft("");
                        }}
                        className="focus-ring rounded-md border border-white/20 px-3 py-2 text-sm font-bold text-white/70 hover:bg-white/8"
                      >
                        取消
                      </button>
                      <button onClick={saveNote} className="focus-ring rounded-md bg-[#81D8CF] px-3 py-2 text-sm font-bold !text-[#343838]">
                        保存
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => forget(point.id)}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 text-sm font-bold hover:bg-white/10"
                  >
                    <XCircle size={15} />
                    没记住
                  </button>
                  <button
                    onClick={() => remember(point.id)}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#81D8CF] text-sm font-bold !text-[#343838]"
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

      {selected && (
        <GrammarExplanation
          point={selected}
          mastery={getMastery(selected.id)}
          note={grammarNote(selected.id)}
          noteDraft={noteEditorId === selected.id ? noteDraft : grammarNote(selected.id)}
          noteEditorOpen={noteEditorId === selected.id}
          onRemember={() => remember(selected.id)}
          onForget={() => forget(selected.id)}
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
  );
};
