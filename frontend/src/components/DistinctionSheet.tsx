import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Check, RotateCcw, X } from "lucide-react";
import { masteredConfusionKeys, setConfusionMastered } from "../lib/confusion-groups";
import type { DistinctionSection } from "../lib/models/word-distinctions";
import { JapaneseWordRuby } from "./JapaneseWordRuby";

/**
 * 学习页的辨析气泡 —— 卡中卡：盖住六成屏幕，学习卡还在后面。
 *
 * 形制刻意和疑难辨析页的大卡一致（60vh、从下方弹起、同一套 TYPE_META 说法），
 * 只是换成学习页的深色皮。两处看到的必须是同一件事的同一个说法。
 *
 * 这里**没有认识/忘记/模糊**：气泡里答案全露着，此时评分等于给 FSRS 灌一条
 * 「记住了」的假数据，正是排片把同组词隔开 12 张要防的事。能留下的只有
 * 「已掌握」，那是疑难辨析页的布尔量，不进 FSRS、不进当日计划。
 */
interface DistinctionSheetProps {
  /** 气泡标题。翻面前必须是题面那行中文，写词形等于把答案送出去 */
  title: string;
  sections: DistinctionSection[];
  /** 还没翻面时，当前这张自己要藏起来 —— 辨析是提示，不是答案 */
  revealed: boolean;
  onClose: () => void;
  /** 「换这张来答」。传了才显示 —— 它会给当前词记一次「模糊」，得是用户明确点的 */
  onJump?: (wordId: number) => void;
  jumpDisabled?: boolean;
}

export const DistinctionSheet = ({ title, sections, revealed, onClose, onJump, jumpDisabled }: DistinctionSheetProps) => {
  const [mastered, setMastered] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setMastered(masteredConfusionKeys());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    // capture：学习页的全局快捷键挂在 window 上，气泡开着的时候别让按键漏过去评分
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const toggleMastered = (key: string) => {
    const next = !mastered.has(key);
    setConfusionMastered(key, next);
    setMastered((previous) => {
      const copy = new Set(previous);
      if (next) copy.add(key); else copy.delete(key);
      return copy;
    });
  };

  return createPortal(
    <div className="wd-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} 的辨析`}>
      <div className="wd-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="wd-head">
          <div>
            <p className="jp-serif wd-title">{title}</p>
          </div>
          <button className="wd-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="wd-body">
          {sections.map((section) => (
            <section key={section.key} className="wd-section">
              <div className="wd-section-head">
                <span className="wd-type"><section.Icon size={13} aria-hidden="true" /> {section.name}</span>
                {section.masterable && (
                  <button
                    className={`wd-master${mastered.has(section.key) ? " is-on" : ""}`}
                    onClick={() => toggleMastered(section.key)}
                  >
                    {mastered.has(section.key)
                      ? <><RotateCcw size={13} /> 取消已掌握</>
                      : <><Check size={13} /> 已掌握</>}
                  </button>
                )}
              </div>
              {section.summary && (
                <p className={`wd-summary${section.level === "major" ? " is-major" : ""}`}>
                  <b>{section.level === "major" ? "不能自由互换" : "通常可互换："}</b>
                  {section.level !== "major" && section.summary}
                </p>
              )}

              <div className="wd-members">
                {section.members.filter((member) => revealed || !member.isCurrent).map((member) => (
                  <div
                    key={`${section.key}-${member.id}-${member.word}-${member.kana}`}
                    className={`wd-member${member.isCurrent ? " is-current" : ""}`}
                  >
                    <div className="wd-member-head">
                      {/* 词形和读音必须并排：整整两类(同表記異読み、同音异义)的区别就在读音上 */}
                      <JapaneseWordRuby
                        surface={member.word}
                        reading={member.kana}
                        className="jp-serif wd-member-word"
                      />
                      <span className="jp wd-member-kana">{member.kana}</span>
                      {member.isCurrent && <span className="wd-member-tag">这张</span>}
                      {member.jlptLevel && <span className="wd-member-level">{member.jlptLevel}</span>}
                    </div>
                    <p className="wd-member-meaning">{member.meaning}</p>
                    {member.note && (
                      <p className={`wd-member-note${section.level === "major" ? " is-major" : ""}`}>
                        {member.note}
                      </p>
                    )}
                    {member.exampleJp && (
                      <p className="jp wd-member-example">
                        {member.exampleJp}
                        <span>{member.exampleMeaning}</span>
                      </p>
                    )}
                    {onJump && !member.isCurrent && member.id > 0 && (
                      <button
                        className="wd-jump"
                        disabled={jumpDisabled}
                        onClick={() => onJump(member.id)}
                        title="当前这张会记一次「模糊」"
                      >
                        <ArrowRightLeft size={13} /> 换这张来答
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
