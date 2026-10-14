import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/AppContext";
import { ComboBadge } from "../../components/ComboBadge";
import { playKnow, playDontKnow } from "../../lib/zoo-sounds";
import { triggerMemoryHaptic } from "../../lib/haptics";
import { getStudyPreferences } from "../../lib/studyPreferences";
import type { KanjiChoiceQuestion } from "../../lib/kanji-choice";

const SOUND_CHANGE_LABELS: Record<string, string> = {
  rendaku: "连浊",
  sokuon: "促音化",
  handaku: "半浊音化",
  "rendaku-handaku": "半浊音化",
  "on-drop": "省音"
};

// 混合卡换题会卸载；一张卡全选对才累计一次，按导航入口保留临时连对，退出/重开即清零。
const visitCombos = new WeakMap<object, { revision: number; combo: number }>();

interface Props {
  char: string;
  question: KanjiChoiceQuestion;
  choices: Record<number, string>;
  activeItem: number;
  revealed: boolean;
  onSelect: (itemIndex: number, option: string) => void;
}

export const KanjiChoiceItems = ({ char, question, choices, activeItem, revealed, onSelect }: Props) => {
  const { state } = useApp();
  const { pageHistory: visit, wordStudyRevision: revision } = state;
  const [result, setResult] = useState(() => {
    const previous = visitCombos.get(visit);
    return { visit, revision, question, revealed: false, combo: previous?.revision === revision ? previous.combo : 0 };
  });
  const played = useRef(false);
  const correct = question.items.every((item, index) => choices[index] === item.answer);
  if (result.visit !== visit || result.revision !== revision || result.question !== question || result.revealed !== revealed) {
    const previous = result.visit === visit && result.revision === revision ? result.combo : 0;
    const combo = revealed ? correct ? previous + 1 : 0 : previous;
    setResult({ visit, revision, question, revealed, combo });
  }
  useEffect(() => {
    if (!revealed) { played.current = false; return; }
    if (played.current || !question.items.length) return;
    played.current = true;
    visitCombos.set(visit, { revision, combo: result.combo });
    triggerMemoryHaptic(correct ? "know" : "forgot");
    if (getStudyPreferences().zooSounds) {
      if (correct) playKnow(result.combo);
      else playDontKnow();
    }
  }, [correct, question.items.length, result.combo, revealed, revision, visit]);
  const answered = question.items.filter((_, index) => choices[index] !== undefined).length;
  return (
  <div className="mx-auto grid min-h-full w-full max-w-2xl content-center gap-5">
    <div className="ds-progress-row">
      <div className="ds-progress" role="progressbar" aria-label="汉字选择进度" aria-valuemin={0} aria-valuemax={question.items.length} aria-valuenow={answered}>
        <div className="ds-progress-fill" style={{ width: `${question.items.length ? answered / question.items.length * 100 : 0}%` }} />
      </div>
      <ComboBadge combo={result.combo} />
    </div>
    {question.items.map((item, itemIndex) => (
      <section key={`${item.wordId}-${item.start}`} className="min-w-0" aria-label={`${item.word}里的${char}读音`}>
        <p className="jp-serif break-words text-3xl font-bold leading-snug text-[var(--ds-ink)]">
          {item.word.slice(0, item.start)}
          <span className="text-[color:var(--quiz-accent)]">{item.word.slice(item.start, item.start + item.length)}</span>
          {item.word.slice(item.start + item.length)}
        </p>
        <p className={`mb-2 mt-1 text-sm ${!revealed && activeItem === itemIndex ? "text-[color:var(--quiz-accent)]" : "text-[var(--ds-ink-2)]"}`}>「{char}」在这里读？</p>
        <div className="grid grid-cols-2 gap-2">
          {item.options.map((option, optionIndex) => {
            const selected = choices[itemIndex] === option;
            const correct = revealed && option === item.answer;
            const wrong = revealed && selected && option !== item.answer;
            return (
              <button
                key={option}
                type="button"
                disabled={revealed}
                aria-pressed={selected}
                aria-label={`${item.word}：${option}${correct ? "，正确答案" : wrong ? "，选错" : ""}`}
                onClick={() => onSelect(itemIndex, option)}
                className={`answer-choice focus-ring flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${correct ? "border-[color:var(--quiz-accent)] bg-[color:var(--quiz-accent-strong)] font-bold text-[var(--ds-ink)]" : wrong ? "border-[var(--ds-warn-ink)] bg-[var(--ds-warn-tint)] text-[var(--ds-warn-ink)]" : selected ? "border-[color:var(--quiz-accent)] bg-[color:var(--quiz-accent-soft)] text-[var(--ds-ink)]" : "border-[var(--ds-line-2)] bg-[var(--ds-surface)] text-[var(--ds-ink)]"}`}
              >
                <span className="shrink-0 text-xs text-[var(--ds-ink-3)]">{optionIndex + 1}</span>
                <span className="jp min-w-0 break-all text-lg font-semibold">{option}</span>
              </button>
            );
          })}
        </div>
        {revealed && (
          <div className="zoo-reveal-in mt-2 space-y-1 break-words text-sm leading-6 text-[var(--ds-ink-2)]">
            <p className="jp font-semibold text-[var(--ds-ink)]">{item.kana}</p>
            <p>{item.meaning}</p>
            {SOUND_CHANGE_LABELS[item.variant] && <p className="jp">{item.base} → {item.answer} · {SOUND_CHANGE_LABELS[item.variant]}</p>}
          </div>
        )}
      </section>
    ))}
  </div>
  );
};
