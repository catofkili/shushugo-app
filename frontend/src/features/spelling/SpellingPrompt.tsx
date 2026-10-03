import { Volume2 } from "lucide-react";
import type { SpellingCard } from "../../lib/spelling";

interface Props {
  card: SpellingCard;
  showMeaning?: boolean;
  showTranslation?: boolean;
  playbackError?: string;
  onReplay?: () => void;
}

export function SpellingPrompt({
  card,
  showMeaning = false,
  showTranslation = true,
  playbackError = "",
  onReplay
}: Props) {
  if (card.mode === "audio") return (
    <section className="sp-question sp-prompt-audio">
      <button type="button" className="ds-btn sp-audio-play" onClick={onReplay} aria-label="播放">
        <Volume2 size={30} aria-hidden="true" />
        <span>播放</span>
      </button>
      <button type="button" className="ds-btn-soft sp-repeat" onClick={onReplay}>再听一次</button>
      {showMeaning && <p className="sp-meaning sp-audio-meaning">{card.meaning}</p>}
      {playbackError && <p className="sp-error" role="status">{playbackError}</p>}
    </section>
  );

  if (card.mode === "cloze") return (
    <section className="sp-question sp-prompt-cloze">
      {card.cloze && <>
        <p className="sp-cloze-sentence" lang="ja">
          {card.cloze.before}<span className="sp-cloze-blank" role="img" aria-label="空欄">____</span>{card.cloze.after}
        </p>
        {showTranslation && <p className="sp-cloze-translation">{card.cloze.translation}</p>}
      </>}
    </section>
  );

  return (
    <section className="sp-question">
      <p className="sp-meaning">{card.meaning}</p>
      <div className="sp-tags">
        {card.pos && <span className="ds-pill">{card.pos}</span>}
        {card.jlptLevel && <span className="ds-pill">{card.jlptLevel}</span>}
        <span className="ds-pill">{card.moraCount} 拍</span>
      </div>
    </section>
  );
}
