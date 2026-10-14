import { Sparkles } from "lucide-react";

export function StudyFocusChest({
  amount,
  claimed,
  caption,
  onClaim
}: {
  amount: number;
  claimed: boolean;
  caption: string;
  onClaim: (button: HTMLButtonElement) => void;
}) {
  return (
    <div className={`study-focus-chest-claim${claimed ? " is-claimed" : ""}`}>
      <button
        className="study-focus-chest"
        type="button"
        onClick={(event) => onClaim(event.currentTarget)}
        disabled={claimed}
        aria-label={caption}
      >
        <span className="study-focus-chest-art" aria-hidden="true">
          <i className="study-focus-chest-aura" />
          <Sparkles size={19} className="study-focus-chest-spark spark-one" aria-hidden="true" />
          <Sparkles size={14} className="study-focus-chest-spark spark-two" aria-hidden="true" />
          <Sparkles size={16} className="study-focus-chest-spark spark-three" aria-hidden="true" />
          <i className="study-focus-chest-lid" />
          <i className="study-focus-chest-band chest-band-lid" />
          <i className="study-focus-chest-base" />
          <i className="study-focus-chest-band chest-band-base" />
          <i className="study-focus-chest-lock"><i /></i>
          <i className="study-focus-chest-prize">+{amount}</i>
        </span>
      </button>
      <span className="study-focus-chest-caption" aria-live="polite">{caption}</span>
    </div>
  );
}
