import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { LevelProgressItem, ProgressOverview } from "../lib/api";
import { JLPTLevel } from "../types/grammar";
import { ProgressFocus } from "../types/app";

interface ProgressOverviewPanelProps {
  overview: ProgressOverview;
  onRefresh: () => void;
  onOpenFill: () => void;
}

const jlptLevels: JLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

export function ProgressOverviewPanel({ overview, onRefresh, onOpenFill }: ProgressOverviewPanelProps) {
  const [progressFocus, setProgressFocus] = useState<ProgressFocus>("both");
  const [progressTouchX, setProgressTouchX] = useState<number | null>(null);

  const handleProgressSwipe = (clientX: number) => {
    if (progressTouchX === null) return;
    const delta = clientX - progressTouchX;
    if (Math.abs(delta) < 38) return;
    setProgressFocus(delta > 0 ? "words" : "grammar");
    setProgressTouchX(null);
  };

  const renderVerticalProgress = (title: string, summary: string, items: LevelProgressItem[], focus: Exclude<ProgressFocus, "both">) => {
    const itemMap = new Map(items.map((item) => [item.level, item]));
    const barItems = jlptLevels.map((level) => itemMap.get(level) ?? { level, total: 0, completed: 0, low: 0, unseen: 0 });
    return (
      <button
        onClick={() => setProgressFocus(progressFocus === focus ? "both" : focus)}
        className={`focus-ring min-w-0 rounded-2xl border p-3 text-left transition-all ${
          progressFocus === focus ? "border-[#81D8CF] bg-[#81D8CF]/12" : "border-white/12 bg-[#373b3b]"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">{title}</p>
            <p className="mt-1 text-[11px] text-white/48">{summary}</p>
          </div>
          <span className="rounded-sm border border-white/12 px-2 py-1 text-[11px] font-bold text-white/54">
            {progressFocus === focus ? "展开" : "轻点"}
          </span>
        </div>
        <div className="mt-4 grid h-32 grid-cols-5 items-end gap-2">
          {barItems.map((item) => {
            const percent = item.total ? Math.round((item.completed / item.total) * 100) : 0;
            return (
              <div key={item.level} className="flex h-full min-w-0 flex-col items-center justify-end">
                <div className="flex h-24 w-full max-w-9 items-end overflow-hidden rounded-t-xl rounded-b-sm bg-[#81D8CF]/15">
                  <div
                    className="w-full rounded-t-xl bg-[#81D8CF] shadow-[0_-6px_18px_rgba(129,216,207,0.22)]"
                    style={{ height: `${Math.max(percent, item.completed ? 8 : 0)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] font-bold text-white/72">{item.level}</p>
                <p className="text-[10px] text-white/42">{percent}%</p>
              </div>
            );
          })}
        </div>
      </button>
    );
  };

  return (
    <div className="mt-5 dictionary-card rounded-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Progress</p>
          <h2 className="mt-1 text-lg font-bold">进度概览</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="focus-ring grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-white/5" title="刷新进度">
            <RotateCcw size={16} />
          </button>
          <button onClick={onOpenFill} className="focus-ring inline-flex h-10 items-center gap-2 rounded-2xl bg-[#81D8CF] px-3 text-sm font-bold !text-[#343838]">
            <CheckCircle2 size={16} />
            填满
          </button>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-white/12 bg-[#81D8CF]/10 p-1">
        {(["both", "words", "grammar"] as ProgressFocus[]).map((focus) => (
          <button
            key={focus}
            onClick={() => setProgressFocus(focus)}
            className={`focus-ring h-8 rounded-xl text-xs font-bold ${progressFocus === focus ? "bg-[#81D8CF] !text-[#343838]" : "text-white/58"}`}
          >
            {focus === "both" ? "双栏" : focus === "words" ? "单词" : "语法"}
          </button>
        ))}
      </div>
      <div
        className={`grid gap-3 ${progressFocus === "both" ? "grid-cols-2" : "grid-cols-1"}`}
        onTouchStart={(event) => setProgressTouchX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => handleProgressSwipe(event.changedTouches[0]?.clientX ?? 0)}
        onPointerDown={(event) => setProgressTouchX(event.clientX)}
        onPointerUp={(event) => handleProgressSwipe(event.clientX)}
      >
        {(progressFocus === "both" || progressFocus === "words") && renderVerticalProgress(
          "单词",
          `${overview.words.completed}/${overview.words.total} · 薄弱 ${overview.words.low} · 未学 ${overview.words.unseen}`,
          overview.wordsByLevel,
          "words"
        )}
        {(progressFocus === "both" || progressFocus === "grammar") && renderVerticalProgress(
          "语法",
          `${overview.grammar.reduce((sum, item) => sum + item.completed, 0)}/${overview.grammar.reduce((sum, item) => sum + item.total, 0)}`,
          overview.grammar,
          "grammar"
        )}
      </div>
    </div>
  );
}
