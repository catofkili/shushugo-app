import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw, X } from "lucide-react";
import {
  confusionGroups,
  displayForm,
  groupWords,
  masteredConfusionKeys,
  setConfusionMastered,
  TYPE_META,
  type ConfusionGroup
} from "../lib/confusion-groups";
import { distinctionReviewFor } from "../data/confusion_distinction_reviews";
import { JapaneseWordRuby } from "../components/JapaneseWordRuby";

/**
 * 疑难辨析。
 *
 * 一屏铺满词组，点开一组放大成大卡看细节，标「已掌握」的沉到最下面。
 *
 * 刻意不接 FSRS、不进当日计划、不影响排片：辨析要把同组词摆在一起看，
 * 而排片规则是**故意把它们隔开 12 张**（防止「答对的是上一张的残留」污染 FSRS）。
 * 两者方向相反，混在一起只会互相破坏。这里存的只有「掌握与否」一个布尔量。
 */

/**
 * 副标题。
 *
 * 成员释义各不相同的组(同音异义、一形多读)不能拿第一个成员的释义当副标题 ——
 * 「観戦 / 汗腺 / 感染」下面写「观看比赛」会让人以为三个词都是这个意思。
 * 那类改用共同的那一项(读音或写法)当副标题。
 */
const cardSub = (group: ConfusionGroup): string => {
  const senses = [...new Set(group.members.map((member) => member.meaning.split(/[；;，,、]/)[0].trim()))];
  if (senses.length === 1) return group.members[0]?.meaning ?? "";
  // 释义不同的组，副标题给「大家共有的那一项」——但共有的是什么因类型而异：
  // 同音类共有读音，同表記类共有写法。自他对和同词根族两样都不共有
  // （欠ける/欠く 读音就不同），硬写「读作 欠く / 欠ける」是错的，那类改列各自的义项。
  if (group.type === "homophone" || group.type === "kanji-choice") return `读作 ${group.label}`;
  if (group.type === "reading-sense" || group.type === "reading-register") return `写作 ${group.label}`;
  return senses.join(" / ");
};

/** 洗牌。种子固定成当天，同一天进来顺序稳定，隔天换一批新鲜感。 */
const shuffled = <T,>(items: T[], seedText: string): T[] => {
  let seed = [...seedText].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 2147483647, 7);
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
};

export const ConfusionPage = () => {
  const [mastered, setMastered] = useState<Set<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const groupsRef = useRef<ConfusionGroup[]>([]);

  useEffect(() => {
    // 建索引要扫全表跑正则（约 30ms），别卡住入场动画
    const timer = window.setTimeout(() => {
      groupsRef.current = confusionGroups();
      setMastered(masteredConfusionKeys());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const ordered = useMemo(() => {
    if (!ready) return [];
    const today = new Date().toISOString().slice(0, 10);
    const list = shuffled(groupsRef.current, today);
    // 已掌握的沉底：不参与随机，永远排在最后，免得每次进来都要翻过它们
    return [
      ...list.filter((group) => !mastered.has(group.key)),
      ...list.filter((group) => mastered.has(group.key))
    ];
  }, [ready, mastered]);

  const toggleMastered = (key: string) => {
    const next = !mastered.has(key);
    setConfusionMastered(key, next);
    setMastered((previous) => {
      const copy = new Set(previous);
      if (next) copy.add(key); else copy.delete(key);
      return copy;
    });
  };

  const open = ordered.find((group) => group.key === openKey) ?? null;
  const openReview = open ? distinctionReviewFor(open.key) : null;
  const remaining = ordered.length - mastered.size;

  if (!ready) {
    return <p className="cf-loading">正在整理词组…</p>;
  }

  return (
    <section className="cf-page">
      <header className="cf-head">
        <div>
          <p className="cf-kick">Confusables</p>
          <h1 className="cf-title">疑难辨析</h1>
        </div>
        <p className="cf-count">
          <b>{remaining}</b> 组待辨 · 已掌握 {mastered.size}
        </p>
      </header>

      <div className="cf-grid">
        {ordered.map((group) => {
          const done = mastered.has(group.key);
          return (
            <button
              key={group.key}
              className={`cf-card${done ? " is-mastered" : ""}${openKey === group.key ? " is-open" : ""}`}
              onClick={() => setOpenKey(group.key)}
            >
              <span className="cf-card-type">
                {TYPE_META[group.type].emoji} {TYPE_META[group.type].name}
              </span>
              <span className="cf-card-words">{groupWords(group)}</span>
              <span className="cf-card-gloss">{cardSub(group)}</span>
              {done && <span className="cf-card-badge">已掌握</span>}
            </button>
          );
        })}
      </div>

      {/* 必须 portal 到 body。大卡的父容器 app-landscape-main 是 position:fixed,
          自成一个层叠上下文,遮罩的 z-index 只在那一层内部比较 —— 留在原地的话
          整个容器(z:auto)都排在 tabbar(z:9999)下面,「已掌握」按钮点不到。 */}
      {open && createPortal(
        <div className="cf-overlay" onClick={() => setOpenKey(null)}>
          <div className="cf-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="cf-sheet-head">
              <span className="cf-sheet-type">
                {TYPE_META[open.type].emoji} {TYPE_META[open.type].name}
              </span>
              <button className="cf-close" onClick={() => setOpenKey(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            {openReview && (
              <p className={`cf-sheet-hint cf-sheet-summary${openReview.level === "major" ? " is-major" : ""}`}>
                <b>{openReview.level === "major" ? "不能自由互换：" : "通常可互换："}</b>
                {openReview.summary}
              </p>
            )}

            <div className="cf-members">
              {open.members.map((member) => (
                <div key={member.id} className="cf-member">
                  <div className="cf-member-head">
                    {/* 词形和读音必须并排显示,不能像单词卡那样只给一个 ——
                        这里有整整两类(同表記異読み、同音异义)的区别就在读音上。 */}
                    <JapaneseWordRuby
                      surface={displayForm(member)}
                      reading={member.kana}
                      className="jp-serif cf-member-word"
                    />
                    <span className="jp cf-member-kana">{member.kana}</span>
                    {member.jlptLevel && <span className="cf-member-level">{member.jlptLevel}</span>}
                  </div>
                  <p className="cf-member-meaning">{member.meaning}</p>
                  {member.exampleJp && (
                    <p className="cf-member-example jp">
                      {member.exampleJp}
                      <span>{member.exampleMeaning}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button
              className={`cf-master${mastered.has(open.key) ? " is-on" : ""}`}
              onClick={() => toggleMastered(open.key)}
            >
              {mastered.has(open.key)
                ? <><RotateCcw size={16} /> 取消已掌握</>
                : <><Check size={16} /> 已掌握</>}
            </button>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};
