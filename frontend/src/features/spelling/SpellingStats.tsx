import { problemLabel, spellingErrorStats, spellingOverrideStats } from "../../lib/spelling";

export function SpellingStats() {
  const errors = spellingErrorStats().slice(0, 5);
  const overrides = spellingOverrideStats();
  const count = overrides.toCorrect + overrides.toWrong;
  if (!errors.length && !count) return null;
  return <section className="ds-card mt-4 p-4 space-y-3" aria-label="最近常错">
    <h2 className="text-sm font-semibold">最近常错</h2>
    {errors.map((error) => <div key={error.code} className="flex items-center justify-between text-sm">
      <span>{problemLabel(error.code)}</span><span className="ds-num">{error.count} 次</span>
    </div>)}
    {count > 0 && <p className="text-xs" style={{ color: "var(--ds-ink-2)" }}>你推翻过我们 {count} 次判定</p>}
  </section>;
}
