import { ArrowRight, CheckCircle2 } from "lucide-react";
import { GrammarTermHint } from "./GrammarTermHint";
import { JapaneseRuby } from "./JapaneseRuby";
import { GrammarPoint, MasteryStatus } from "../types/grammar";

const statusLabel: Record<MasteryStatus, string> = {
  new: "New",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered"
};

interface GrammarCardProps {
  point: GrammarPoint;
  mastery: MasteryStatus;
  onOpen: (id: string) => void;
  onMarkLearned?: (id: string) => void;
}

export const GrammarCard = ({ point, mastery, onOpen, onMarkLearned }: GrammarCardProps) => (
  <article
    className="focus-ring group flex h-full w-full flex-col justify-between rounded-lg border border-stone-200 bg-[#81D8CF] p-5 text-left shadow-sm transition dark:border-zinc-800 dark:bg-zinc-900"
  >
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#81D8CF] dark:text-[#81D8CF]">
            {point.level}
          </p>
          <h3 className="jp mt-1 text-2xl font-bold text-stone-950 dark:text-zinc-50">
            <JapaneseRuby text={point.title} />
          </h3>
        </div>
        <span className="rounded-full bg-[#81D8CF] px-3 py-1 text-xs font-medium text-stone-600 dark:bg-zinc-800 dark:text-zinc-300">
          {statusLabel[mastery]}
        </span>
      </div>
      <p className="text-sm text-stone-700 dark:text-zinc-300">{point.meaning}</p>
      <p className="jp rounded-md bg-[#81D8CF] px-3 py-2 text-sm text-stone-700 dark:bg-zinc-800 dark:text-zinc-300">
        <GrammarTermHint text={point.connection ?? point.structure} />
      </p>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
      <button
        onClick={() => onOpen(point.id)}
        className="focus-ring inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold text-[#81D8CF] dark:text-[#81D8CF]"
      >
        Study <ArrowRight size={15} />
      </button>
      {onMarkLearned && (
        <button
          onClick={() => onMarkLearned(point.id)}
          className={`focus-ring inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold ${
            mastery === "new"
              ? "bg-[#81D8CF] text-white hover:bg-[#81D8CF]"
              : "bg-[#81D8CF] text-stone-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          <CheckCircle2 size={14} />
          {mastery === "new" ? "Mark" : "Learned"}
        </button>
      )}
    </div>
  </article>
);
