import { useState } from "react";
import {
  amendSpellingRound, askedToday, availableSpellingModes, checkCardInput, chooseSpellingMode,
  getSpellingPrefs, gradeRound, inlineSpellingDecision, lastEncounterToday, markAskedToday,
  recordSpellingAnswer, roundOutcome, seedSpellingCardFor, spellingCard, spellingDoneToday,
  spellingInlineToday, spellingLookup, type SpellingPrefs, type SpellingRound
} from "../../lib/spelling";
import { firstValue } from "../../lib/study-core";
import { LEECH_LAPSE_THRESHOLD } from "../../lib/fsrs-scheduler";
import { getStudyPreferences } from "../../lib/studyPreferences";
import { SpellingCardView } from "./SpellingCardView";

export const shouldInlineSpelling = (wordId: number, prefs: SpellingPrefs): boolean =>
  inlineSpellingDecision(wordId, prefs, {
    lastEncounterToday, spellingInlineToday, spellingDoneToday, askedToday,
    seed: (id, options) => {
      // 已有拼写卡的播种接口恒为 true；插播仍须遵守当前正向资格。
      const eligible = firstValue<number>(`SELECT EXISTS(SELECT 1 FROM progress WHERE word_id = ?
        AND seen_count > 0 AND known_forever = 0 AND COALESCE(fsrs_lapses, 0) < ?
        AND fsrs_stability >= ? AND fsrs_due IS NOT NULL)`, [id, LEECH_LAPSE_THRESHOLD, options.minStabilityDays], 0);
      return !!eligible && seedSpellingCardFor(id, options);
    }
  }).show;

export default function SpellingInline({ wordId, onClose }: { wordId: number; onClose: () => void }) {
  const [session] = useState(() => {
    const prefs = getSpellingPrefs();
    const mode = chooseSpellingMode(wordId, prefs, availableSpellingModes(wordId));
    return { prefs, card: spellingCard(wordId, mode), lookup: spellingLookup(wordId), study: getStudyPreferences() };
  });
  const close = () => { markAskedToday(wordId); onClose(); };
  const finish = (round: SpellingRound) => {
    const outcome = roundOutcome(round);
    const last = round.attempts[round.attempts.length - 1];
    recordSpellingAnswer(wordId, gradeRound(round), {
      typed: last?.typed ?? "", form: last?.verdict.form ?? "empty", hints: round.hintsUsed,
      tries: outcome.tries, ms: Math.max(0, Math.round(round.elapsedMs)),
      problem: round.gaveUp ? "gave_up" : last && !last.verdict.correct ? last.verdict.problems[0]?.code ?? "" : "",
      override: outcome.overridden ? round.override : "", mode: session.card?.mode, source: "inline"
    });
    markAskedToday(wordId);
    if (!round.gaveUp && (outcome.overridden ? round.override === "correct" : last?.verdict.correct)) onClose();
  };
  return <section className="sp-page" aria-label="单词拼写插播">
    <header className="sp-header"><p className="sp-progress">拼写</p>
      <div className="flex gap-2"><button type="button" className="ds-btn-soft sp-button" disabled aria-label="上一个">上一个</button>
        <button type="button" className="ds-btn-soft sp-button" onClick={close}>跳过</button></div></header>
    {session.card ? <SpellingCardView card={session.card}
      checkInput={(typed) => checkCardInput(session.card!, typed, session.lookup)}
      onFinish={finish} onAmend={(round) => {
        amendSpellingRound(wordId, round);
        if (roundOutcome(round).answer !== "forgot") close();
      }} onNext={close} nextLabel="继续"
      showMeaning={session.prefs.showMeaningInAudio} showTranslation={session.prefs.clozeShowTranslation}
      autoPlay={session.study.autoPlay} voiceId={session.study.voiceId} />
      : <button type="button" className="ds-btn sp-button" onClick={close}>继续</button>}
  </section>;
}
