import { createPortal } from "react-dom";
import { Timer } from "lucide-react";
import { ScrollArea } from "./ScrollArea";
import { STUDY_FOCUS_MIN_WORDS, STUDY_FOCUS_REWARDS } from "../lib/study-focus";

/**
 * 勾上主页「倒计时」之前的说明。离开背词页作废奖励这条必须在开始之前说，
 * 所以放在勾选那一下，而不是进了背词页再弹。
 */
export function StudyFocusIntro({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return createPortal(
    <ScrollArea className="study-focus-veil">
      <section className="study-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="study-focus-intro-title">
        <span className="study-focus-kicker"><Timer size={16} /> 十分钟专注</span>
        <h2 id="study-focus-intro-title">开启倒计时学习？</h2>
        <p>进背词页就开始倒计时，每专注 10 分钟停下来休息一次，看看这段背得怎么样。</p>
        <p>中途离开背词页，这一段的额外柚子作废；背够 {STUDY_FOCUS_MIN_WORDS} 个词、完成后点「继续」才会领取。</p>
        <p className="study-focus-reward-note">全程倒计时可得超过 200 柚子</p>
        <p className="study-focus-tiers">奖励依次为：{STUDY_FOCUS_REWARDS.join("、")}，每天最多九段。</p>
        <div className="study-focus-actions">
          <button className="study-focus-secondary" onClick={onCancel}>暂不</button>
          <button className="study-focus-primary" onClick={onConfirm}>开启倒计时</button>
        </div>
      </section>
    </ScrollArea>,
    document.body
  );
}
