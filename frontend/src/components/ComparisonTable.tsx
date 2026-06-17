import { GrammarPoint } from "../types/grammar";

interface ComparisonTableProps {
  left: GrammarPoint;
  right: GrammarPoint;
  usage: string;
  nuance: string;
  structure: string;
  examples: string[];
}

export const ComparisonTable = ({
  left,
  right,
  usage,
  nuance,
  structure,
  examples
}: ComparisonTableProps) => (
  <div className="overflow-hidden rounded-2xl border border-stone-200 bg-[#81D8CF] dark:border-zinc-800 dark:bg-zinc-900">
    <div className="grid grid-cols-2 border-b border-stone-200 dark:border-zinc-800">
      <div className="p-4">
        <p className="jp text-2xl font-bold text-stone-950 dark:text-zinc-50">{left.title}</p>
        <p className="mt-1 text-sm text-stone-600 dark:text-zinc-400">{left.meaning}</p>
      </div>
      <div className="border-l border-stone-200 p-4 dark:border-zinc-800">
        <p className="jp text-2xl font-bold text-stone-950 dark:text-zinc-50">{right.title}</p>
        <p className="mt-1 text-sm text-stone-600 dark:text-zinc-400">{right.meaning}</p>
      </div>
    </div>
    <div className="divide-y divide-stone-200 text-sm dark:divide-zinc-800">
      {[
        ["Usage", usage],
        ["Nuance", nuance],
        ["Structure", structure],
        ["Examples", examples.join(" / ")]
      ].map(([label, text]) => (
        <div key={label} className="grid gap-3 p-4 sm:grid-cols-[120px_1fr]">
          <p className="font-semibold text-stone-500 dark:text-zinc-400">{label}</p>
          <p className="jp text-stone-800 dark:text-zinc-200">{text}</p>
        </div>
      ))}
    </div>
  </div>
);
