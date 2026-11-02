import { useState } from "react";
import { createPortal } from "react-dom";
import { Timer } from "lucide-react";
import { ScrollArea } from "./ScrollArea";
import { StudyFocusMinutes } from "./StudyFocusMinutes";
import { getStudyFocusMinutes, isStudyFocusArmed, setStudyFocusMinutes } from "../lib/study-focus";
import { focusMinimumMs, focusMinimumWords, focusRoundRewards } from "../lib/yuzu";

/**
 * 勾上主页「倒计时」之前的说明。暂停 / 作废的规则必须在开始之前说，
 * 所以放在勾选那一下，而不是进了背词页再弹。
 */
export function StudyFocusIntro({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [minutes, setMinutes] = useState(getStudyFocusMinutes);
  const armed = isStudyFocusArmed();
  return createPortal(
    <ScrollArea className="study-focus-veil">
      <section className="study-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="study-focus-intro-title">
        <span className="study-focus-kicker"><Timer size={16} /> {minutes} 分钟专注</span>
        <h2 id="study-focus-intro-title">开启倒计时学习？</h2>
        <p>进背词页就开始倒计时，每专注一段时间停下来休息一次，看看这段背得怎么样。每段多长自己选：</p>
        <StudyFocusMinutes minutes={minutes} onChange={setMinutes} />
        <p>离开背词页倒计时会先暂停，当天回来接着走。每段满 {minutes} 分钟、背够 {focusMinimumWords(minutes)} 个词可领本轮奖励；当天计划提前完成时，本轮满 {focusMinimumMs(minutes) / 60_000} 分钟且背够 {focusMinimumWords(minutes)} 个词，也会放进结尾宝箱。</p>
        <p className="study-focus-reward-note">全程倒计时可得超过 200 柚子</p>
        <p className="study-focus-tiers">奖励依次为：{focusRoundRewards(minutes).join("、")}。不管每段多长，一天专注约 90 分钟封顶，总量一样。</p>
        <div className="study-focus-actions">
          <button className="study-focus-secondary" onClick={onCancel}>暂不</button>
          <button className="study-focus-primary" onClick={() => { setStudyFocusMinutes(minutes); onConfirm(); }}>{armed ? "确定" : "开启倒计时"}</button>
        </div>
      </section>
    </ScrollArea>,
    document.body
  );
}
