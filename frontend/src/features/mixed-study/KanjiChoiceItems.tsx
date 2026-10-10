import type { KanjiChoiceQuestion } from "../../lib/kanji-choice";

const SOUND_CHANGE_LABELS: Record<string, string> = {
  rendaku: "连浊",
  sokuon: "促音化",
  handaku: "半浊音化",
  "rendaku-handaku": "半浊音化",
  "on-drop": "省音"
};

interface Props {
  char: string;
  question: KanjiChoiceQuestion;
  choices: Record<number, string>;
  activeItem: number;
  revealed: boolean;
  onSelect: (itemIndex: number, option: string) => void;
}

export const KanjiChoiceItems = ({ char, question, choices, activeItem, revealed, onSelect }: Props) => (
  <div className="mx-auto grid min-h-full w-full max-w-2xl content-center gap-5">
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
                className={`focus-ring flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${correct ? "border-[color:var(--quiz-accent)] bg-[color:var(--quiz-accent-strong)] font-bold text-[var(--ds-ink)]" : wrong ? "border-[var(--ds-danger)] bg-[var(--ds-surface)] text-[var(--ds-danger)]" : selected ? "border-[color:var(--quiz-accent)] bg-[color:var(--quiz-accent-soft)] text-[var(--ds-ink)]" : "border-[var(--ds-line-2)] bg-[var(--ds-surface)] text-[var(--ds-ink)]"}`}
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
