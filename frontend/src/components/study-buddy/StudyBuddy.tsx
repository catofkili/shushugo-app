import { useEffect, useSyncExternalStore } from "react";
import { Sticker, stickerUrl, useMascotSkin, type StickerName } from "../CapybaraMascot";
import { jsMotionAllowed, getStudyPreferences } from "../../lib/studyPreferences";
import { playStreakChirp } from "../../lib/zoo-sounds";
import type { BuddyFrame, StudyBuddySession } from "../../lib/study-buddy";
import "./StudyBuddy.css";

// Replace only this table when the aligned buddy frames arrive (§4.3); Sticker keeps equipped skins.
const FRAMES: Record<BuddyFrame, StickerName> = {
  idle: "mood-default", blink: "mood-default", happy: "mood-yay", cheer: "mood-cheer",
  worried: "mood-puzzled", sad: "mood-puzzled", think: "mood-ask", sleepy: "mood-sleep",
  surprised: "mood-surprised", shy: "mood-shy", wave: "mood-wave", eat: "mood-hungry", dizzy: "mood-dizzy"
};

export function StudyBuddy({ session }: { session: StudyBuddySession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const skin = useMascotSkin();
  useEffect(() => {
    if (typeof Image === "undefined") return; // Mini-program stickers are local assets.
    [...new Set(Object.values(FRAMES))].forEach((name) => { const img = new Image(); img.src = stickerUrl(name, skin); });
  }, [skin]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const s = session.getSnapshot();
      const now = Date.now();
      const deadlines = [s.lastInteraction + 60000, s.frameUntil, s.speech ? s.speechUntil : 0];
      if (jsMotionAllowed() && s.frame === "idle") deadlines.push(s.nextBlink);
      if (s.pending.length && s.spoken < 6) deadlines.push(Math.max(s.feedbackUntil, s.lastSpoken + 20000));
      const next = Math.min(...deadlines.filter((at) => at > now));
      // A sleeping buddy with no pending cue needs no wakeups until the next interaction.
      if (Number.isFinite(next)) timer = setTimeout(() => { session.send({ type: "tick", now: Date.now(), motion: jsMotionAllowed() }); }, Math.max(1, next - now));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [session, state]);

  const tap = () => {
    session.send({ type: "tap" });
    if (session.getSnapshot().action === "hop" && getStudyPreferences().zooSounds) playStreakChirp();
  };
  return (
    <div className="sbuddy" data-frame={state.frame}>
      <button type="button" aria-label="水豚" className="sbuddy-button focus-ring" onClick={tap}>
        <span key={state.actionId} className={`sbuddy-pose sbuddy-${state.action}`}>
          <Sticker name={FRAMES[state.frame]} size={72} className="sbuddy-image" />
          <i className="sbuddy-glow" aria-hidden="true" />
          <i className="sbuddy-blush sbuddy-blush-left" aria-hidden="true" /><i className="sbuddy-blush sbuddy-blush-right" aria-hidden="true" />
          <i className="sbuddy-crumb sbuddy-crumb-one" aria-hidden="true" /><i className="sbuddy-crumb sbuddy-crumb-two" aria-hidden="true" />
          <span className="sbuddy-stars" aria-hidden="true"><i className="sbuddy-star sbuddy-star-one" /><i className="sbuddy-star sbuddy-star-two" /><i className="sbuddy-star sbuddy-star-three" /></span>
        </span>
        {state.speech && <span className="sbuddy-bubble" role="status" onClick={(event) => { event.stopPropagation(); session.send({ type: "dismiss" }); }}>{state.speech}</span>}
      </button>
    </div>
  );
}
