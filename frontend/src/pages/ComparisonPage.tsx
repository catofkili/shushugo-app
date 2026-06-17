import { useMemo, useState } from "react";
import { ComparisonTable } from "../components/ComparisonTable";
import { grammarPoints } from "../data/grammar";
import { presetComparisons } from "../data/comparisons";

export const ComparisonPage = () => {
  const [leftId, setLeftId] = useState(grammarPoints[0]?.id ?? "");
  const [rightId, setRightId] = useState(grammarPoints[1]?.id ?? grammarPoints[0]?.id ?? "");
  const [presetId, setPresetId] = useState(presetComparisons[0]?.id ?? "");

  const preset = presetComparisons.find((item) => item.id === presetId) ?? presetComparisons[0];
  const left = grammarPoints.find((point) => point.id === leftId) ?? grammarPoints[0];
  const right = grammarPoints.find((point) => point.id === rightId) ?? grammarPoints[1];
  const rowText = (aspect: string, fallback = "") => {
    const row = preset.rows.find((item) => item.aspect === aspect);
    return row ? `${preset.titleA}：${row.a}；${preset.titleB}：${row.b}` : fallback;
  };
  const findByTitle = (title: string) =>
    grammarPoints.find((point) => point.title.includes(title)) ?? grammarPoints[0];

  const customText = useMemo(
    () => ({
      usage: `${left.title}：${left.meaning}。${right.title}：${right.meaning}。`,
      nuance: `${left.explanation} ${right.explanation}`,
      structure: `${left.structure} / ${right.structure}`,
      examples: [left.examples[0]?.jp ?? left.examples[0]?.japanese ?? "", right.examples[0]?.jp ?? right.examples[0]?.japanese ?? ""]
    }),
    [left, right]
  );

  const presetLeft = preset.leftId ? grammarPoints.find((point) => point.id === preset.leftId) ?? left : findByTitle(preset.titleA);
  const presetRight = preset.rightId ? grammarPoints.find((point) => point.id === preset.rightId) ?? right : findByTitle(preset.titleB);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold text-stone-950 dark:text-zinc-50">Comparison</h1>
        <p className="mt-2 text-stone-600 dark:text-zinc-400">把容易混的语法放在一起看，不用在脑子里打结。</p>
      </div>
      <section className="rounded-2xl border border-stone-200 bg-[#81D8CF] p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-bold text-stone-950 dark:text-zinc-50">Preset comparisons</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {presetComparisons.map((item) => (
            <button
              key={item.id}
              onClick={() => setPresetId(item.id)}
              className={`focus-ring rounded-2xl px-4 py-2 text-sm font-semibold ${
                presetId === item.id
                  ? "bg-[#81D8CF] text-white"
                  : "bg-[#81D8CF] text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {item.title ?? `${item.titleA} vs ${item.titleB}`}
            </button>
          ))}
        </div>
      </section>
      <ComparisonTable
        left={presetLeft}
        right={presetRight}
        usage={preset.usage ?? rowText("用法", preset.summary)}
        nuance={preset.nuance ?? rowText("语感", preset.summary)}
        structure={preset.structure ?? rowText("结构")}
        examples={preset.examples ?? [rowText("例句")]}
      />
      <section className="rounded-2xl border border-stone-200 bg-[#81D8CF] p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-bold text-stone-950 dark:text-zinc-50">Custom compare</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[leftId, rightId].map((value, index) => (
            <select
              key={index}
              value={value}
              onChange={(event) => (index === 0 ? setLeftId(event.target.value) : setRightId(event.target.value))}
              className="focus-ring control-cyan soft-text-outline rounded-2xl border px-3 py-2 text-sm font-bold"
            >
              {grammarPoints.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.title} · {point.meaning}
                </option>
              ))}
            </select>
          ))}
        </div>
      </section>
      <ComparisonTable
        left={left}
        right={right}
        usage={customText.usage}
        nuance={customText.nuance}
        structure={customText.structure}
        examples={customText.examples}
      />
    </div>
  );
};
