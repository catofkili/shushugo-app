import { useEffect, useState } from "react";
import { ArrowLeft, StickyNote, X } from "lucide-react";
import { ExampleSentence } from "../components/ExampleSentence";
import { GrammarTermHint } from "../components/GrammarTermHint";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { ReviewButton } from "../components/ReviewButton";
import { grammarPoints } from "../data/grammar";
import { getGrammarNote, setGrammarNote } from "../lib/grammarNotes";
import { grammarSequence } from "../lib/grammar-numbering";
import { getGrammarTitleFurigana } from "../lib/grammar-title-furigana";
import { MasteryStatus } from "../types/grammar";

interface GrammarDetailProps {
  grammarId: string;
  getMastery: (id: string) => MasteryStatus;
  onBack: () => void;
  onLearned: (id: string) => void;
  onReview: (id: string) => void;
}

export const GrammarDetail = ({
  grammarId,
  getMastery,
  onBack,
  onLearned,
  onReview
}: GrammarDetailProps) => {
  const point = grammarPoints.find((item) => item.id === grammarId) ?? grammarPoints[0];
  const mastery = getMastery(point.id);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(() => getGrammarNote(point.id));
  const [, setNoteVersion] = useState(0);
  const note = getGrammarNote(point.id);

  useEffect(() => {
    setNoteEditorOpen(false);
    setNoteDraft(getGrammarNote(point.id));
  }, [point.id]);
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-1 text-sm font-semibold text-[#f9faf7] hover:text-[#343838] dark:text-zinc-400 dark:hover:text-zinc-50">
        <ArrowLeft size={16} />
        返回语法辞典
      </button>
      <section data-grammar-point-id={point.id} className="dictionary-card rounded-2xl p-6">
        <div className="flex flex-col justify-between gap-5 md:flex-row">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#81D8CF]">{grammarSequence(point).label} · {mastery}</p>
            <h1 data-grammar-point-id={point.id} data-grammar-highlight-block="title" className="jp-serif mt-3 text-6xl font-semibold leading-none text-[#343838] dark:text-[#f4efe4]"><JapaneseRuby text={point.title} furigana={getGrammarTitleFurigana(point.id)} /></h1>
            <p data-grammar-point-id={point.id} data-grammar-highlight-block="meaning" className="mt-4 text-xl text-[#f9faf7] dark:text-zinc-200">{point.meaning}</p>
            <p data-grammar-point-id={point.id} data-grammar-highlight-block="formation" className="jp mt-4 inline-block border-l-2 border-[#81D8CF] bg-[#81D8CF] px-3 py-2 text-[#f9faf7] dark:bg-[#171611] dark:text-zinc-200">
              <GrammarTermHint text={point.connection ?? point.structure} />
            </p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => {
                setNoteDraft(getGrammarNote(point.id));
                setNoteEditorOpen(true);
              }}
              className={`focus-ring inline-flex items-center gap-2 rounded-2xl border border-[#81D8CF] px-4 py-2 text-sm font-semibold hover:bg-[#81D8CF] ${note ? "bg-[#81D8CF] !text-[#343838]" : ""}`}
            >
              <StickyNote size={16} />
              {note ? "编辑备注" : "添加备注"}
            </button>
            <ReviewButton learned={mastery !== "new"} onLearned={() => onLearned(point.id)} onReview={() => onReview(point.id)} />
          </div>
        </div>
        {(note || noteEditorOpen) && (
          <div className="mt-5 rounded-2xl border border-white/15 bg-[#373b3b] p-4">
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
        <p data-grammar-point-id={point.id} data-grammar-highlight-block="explanation" className="mt-6 max-w-3xl border-t border-[#81D8CF] pt-5 text-[15px] leading-8 text-[#f9faf7] dark:border-zinc-800 dark:text-zinc-300">{point.explanation}</p>
      </section>

      <section>
        <h2 className="jp mb-4 text-lg font-semibold text-[#343838] dark:text-zinc-50">例句</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {point.examples.map((example, exampleIndex) => (
            <div key={example.jp ?? example.japanese} data-grammar-point-id={point.id} data-grammar-highlight-block={`point-example-${exampleIndex}`}>
              <ExampleSentence example={example} grammarPoint={point} />
            </div>
          ))}
        </div>
      </section>

    </div>
  );
};
