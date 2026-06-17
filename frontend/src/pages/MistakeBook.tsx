import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { getGrammarMistakes, GrammarMistakeItem, prioritizeGrammarMistake, resolveGrammarMistake } from "../lib/api";

interface MistakeBookProps {
  onPractice?: () => void;
}

export const MistakeBook = ({ onPractice }: MistakeBookProps) => {
  const [mistakes, setMistakes] = useState<GrammarMistakeItem[]>([]);

  const load = () => setMistakes(getGrammarMistakes(80));

  useEffect(() => {
    load();
  }, []);

  const resolve = (grammarId: number) => {
    setMistakes(resolveGrammarMistake(grammarId));
  };

  const practice = (grammarId: number) => {
    prioritizeGrammarMistake(grammarId);
    onPractice?.();
  };

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <div className="dictionary-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Mistake Book</p>
            <h1 className="mt-1 text-2xl font-semibold">错题本</h1>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/14 text-[#81D8CF]">
            <TriangleAlert size={22} />
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/58">
          语法练习里点“忘记”或“模糊”会自动进入这里；之后同一语法点答“认识”或“熟知”会自动移出。
        </p>
      </div>

      {mistakes.length === 0 ? (
        <div className="dictionary-card rounded-2xl p-8 text-center">
          <CheckCircle2 className="mx-auto text-[#81D8CF]" size={36} />
          <p className="mt-4 text-lg font-bold">现在没有活跃错题</p>
          <p className="mt-2 text-sm text-white/55">继续练习，薄弱语法会自动出现在这里。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {mistakes.map((mistake) => (
            <article key={mistake.grammarId} className="dictionary-card rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/14 text-[#81D8CF]">
                  <TriangleAlert size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/58">{mistake.level}</span>
                    <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/58">上次：{mistake.answerLabel}</span>
                    <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/58">累计 {mistake.mistakeCount}</span>
                  </div>
                  <h2 className="jp-serif mt-3 text-2xl font-semibold leading-tight">{mistake.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-white/70">{mistake.meaning}</p>
                  {mistake.example.jp && (
                    <div className="mt-3 rounded-2xl border border-white/12 bg-[#373b3b] p-3">
                      <p className="jp text-base leading-7">{mistake.example.jp}</p>
                      <p className="mt-1 text-xs leading-5 text-white/55">{mistake.example.meaning}</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => resolve(mistake.grammarId)}
                  className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-[#81D8CF]/10 text-sm font-bold text-white/72 hover:bg-[#81D8CF]/15"
                >
                  <Trash2 size={15} />
                  手动移除
                </button>
                <button
                  onClick={() => practice(mistake.grammarId)}
                  className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] text-sm font-bold !text-[#343838]"
                >
                  <RotateCcw size={15} />
                  立刻练
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
