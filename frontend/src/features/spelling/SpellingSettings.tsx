import type { ReactNode } from "react";
import { saveSpellingPrefs, type SpellingMode, type SpellingPrefs } from "../../lib/spelling";

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><p className="text-sm font-semibold">{label}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>{children}</div></div>;
}

export function SpellingSettings({ prefs, onChange, onClose }: {
  prefs: SpellingPrefs;
  onChange: (prefs: SpellingPrefs) => void;
  onClose: () => void;
}) {
  const update = (patch: Partial<SpellingPrefs>) => onChange(saveSpellingPrefs(patch));
  const toggleMode = (mode: SpellingMode) => {
    const modes = prefs.modes.includes(mode) ? prefs.modes.filter((value) => value !== mode) : [...prefs.modes, mode];
    if (modes.length) update({ modes });
  };
  const numbers = (field: "dailyCap" | "minStabilityDays" | "inlineDailyCap", values: number[]) =>
    values.map((value) => <button key={value} type="button" className="ds-chip" aria-pressed={prefs[field] === value}
      onClick={() => update({ [field]: value })}>{value === 0 ? "不限" : field === "minStabilityDays" ? `稳定 ≥${value} 天` : value}</button>);
  const toggle = (field: "inlineAfterGraduation" | "showMeaningInAudio" | "clozeShowTranslation", label: string) =>
    <button type="button" className="ds-chip text-left" aria-pressed={prefs[field]}
      onClick={() => update({ [field]: !prefs[field] })}>{label}</button>;
  return <section id="spelling-settings" className="ds-card p-4 mb-4 space-y-4" aria-label="拼写设置">
    <div className="flex items-center justify-between"><h2 className="text-base font-semibold">拼写设置</h2>
      <button type="button" className="ds-btn-soft sp-button" onClick={onClose}>收起</button></div>
    <Choices label="题面形式">{([ ["meaning", "释义"], ["audio", "听写"], ["cloze", "挖空"] ] as const).map(([mode, label]) =>
      <button key={mode} type="button" className="ds-chip" aria-pressed={prefs.modes.includes(mode)}
        disabled={prefs.modes.length === 1 && prefs.modes[0] === mode} onClick={() => toggleMode(mode)}>{label}</button>)}</Choices>
    {prefs.modes.length >= 2 && <Choices label="选择方式">{([ ["random", "随机"], ["rotate", "轮换"] ] as const).map(([modeStrategy, label]) =>
      <button key={modeStrategy} type="button" className="ds-chip" aria-pressed={prefs.modeStrategy === modeStrategy}
        onClick={() => update({ modeStrategy })}>{label}</button>)}</Choices>}
    <Choices label="每天上限">{numbers("dailyCap", [10, 20, 30, 50, 0])}</Choices>
    <Choices label="度">{numbers("minStabilityDays", [0, 7, 21, 60])}</Choices>
    <p className="text-xs" style={{ color: "var(--ds-ink-2)" }}>只拼已经比较熟的词</p>
    <Choices label="学习时插播">{toggle("inlineAfterGraduation", "每个词当天最后一次见到时拼一次")}</Choices>
    {prefs.inlineAfterGraduation && <Choices label="插播上限">{numbers("inlineDailyCap", [3, 5, 10])}</Choices>}
    <Choices label="题面提示">{toggle("showMeaningInAudio", "听写时显示释义")}{toggle("clozeShowTranslation", "挖空显示译文")}</Choices>
  </section>;
}
