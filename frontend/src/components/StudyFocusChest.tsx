export function StudyFocusChest({
  amount,
  claimed,
  caption,
  onClaim
}: {
  amount: number;
  claimed: boolean;
  caption: string;
  onClaim: () => void;
}) {
  return (
    <div className={`study-focus-chest-claim${claimed ? " is-claimed" : ""}`}>
      <button
        className="study-focus-chest"
        type="button"
        onClick={onClaim}
        disabled={claimed}
        aria-label={caption}
      >
        <span className="study-focus-chest-art" aria-hidden="true">
          <i className="study-focus-chest-aura" />
          <i className="study-focus-chest-spark spark-one">✦</i>
          <i className="study-focus-chest-spark spark-two">✧</i>
          <i className="study-focus-chest-spark spark-three">✦</i>
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
