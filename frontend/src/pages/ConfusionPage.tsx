import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import {
  confusionGroups,
  CONFUSION_TYPES,
  displayForm,
  groupWordParts,
  masteredConfusionKeys,
  setConfusionMastered,
  TYPE_META,
  type ConfusionGroup,
  type ConfusionType
} from "../lib/confusion-groups";
import { distinctionNotesFor, distinctionReviewFor } from "../data/confusion_distinction_reviews";
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

/**
 * 一组的可搜文本 = 词形 + 假名 + 释义 + 组标签。
 *
 * 缓存在 WeakMap 里：1,933 组、上万个成员，每敲一个键都重拼一遍是白烧 CPU
 * （实测拼一次 ~25ms，敲十个字就是四分之一秒的卡顿）。组对象在一次会话里不变，
 * 用它自己当键最省事，不用维护失效。
 */
const searchTextCache = new WeakMap<ConfusionGroup, string>();

const searchTextOf = (group: ConfusionGroup): string => {
  const cached = searchTextCache.get(group);
  if (cached !== undefined) return cached;
  const text = [
    group.label,
    ...group.members.flatMap((member) => [displayForm(member), member.kanji, member.kana, member.meaning])
  ].join(" ").toLowerCase();
  searchTextCache.set(group, text);
  return text;
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
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<ConfusionType | "all">("all");
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

  /** 搜索：词形 / 假名 / 释义 / 组标签，任意一处命中即可。空查询直接返回原表。 */
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter((group) => searchTextOf(group).includes(needle));
  }, [ordered, query]);

  /** 每一类还剩多少（跟着搜索走：搜完之后角标要说的是「这一类里搜到几个」）。 */
  const countsByType = useMemo(() => {
    const counts = new Map<ConfusionType, number>();
    matched.forEach((group) => counts.set(group.type, (counts.get(group.type) ?? 0) + 1));
    return counts;
  }, [matched]);

  /**
   * 分节：七类各自一节。选中某一类时只留那一节 —— 用同一份数据同一段渲染，
   * 不为「筛选」和「分组」各写一套。
   */
  const sections = useMemo(() => CONFUSION_TYPES
    .filter((type) => activeType === "all" || type === activeType)
    .map((type) => ({ type, groups: matched.filter((group) => group.type === type) }))
    .filter((section) => section.groups.length > 0),
  [matched, activeType]);

  const open = ordered.find((group) => group.key === openKey) ?? null;
  const openReview = open ? distinctionReviewFor(open.key) : null;
  const openNotes = open && openReview?.level === "major"
    ? distinctionNotesFor(openReview.summary, open.members.map((member) => ({
        key: String(member.id),
        forms: [displayForm(member), member.kanji, member.kana]
      })))
    : new Map<string, string>();
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

      <label className="cf-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜词形、假名或释义"
          aria-label="搜索词组"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
            <X size={14} />
          </button>
        )}
      </label>

      <div className="cf-types">
        <button
          className={`cf-type-chip${activeType === "all" ? " on" : ""}`}
          onClick={() => setActiveType("all")}
        >
          全部 {matched.length}
        </button>
        {CONFUSION_TYPES.map((type) => {
          const meta = TYPE_META[type];
          const count = countsByType.get(type) ?? 0;
          return (
            <button
              key={type}
              className={`cf-type-chip${activeType === type ? " on" : ""}`}
              onClick={() => setActiveType(activeType === type ? "all" : type)}
              disabled={count === 0}
            >
              <meta.Icon size={13} aria-hidden="true" />
              {meta.name} {count}
            </button>
          );
        })}
      </div>

      {sections.length === 0 && (
        <p className="cf-loading">没有匹配的词组</p>
      )}

      {sections.map((section) => {
        const meta = TYPE_META[section.type];
        return (
          <section key={section.type} className="cf-section">
            {/* 一类一节。选中某一类时这里只剩一节，标题照旧留着 ——
                没有标题的话「现在看的是哪一类」只能靠 chip 的高亮去猜。 */}
            <p className="cf-section-head">
              <meta.Icon size={14} aria-hidden="true" />
              <b>{meta.name}</b>
              <small>{section.groups.length} 组</small>
            </p>
            <div className="cf-grid">
              {section.groups.map((group) => {
                const done = mastered.has(group.key);
                return (
                  <button
                    key={group.key}
                    className={`cf-card${done ? " is-mastered" : ""}${openKey === group.key ? " is-open" : ""}`}
                    onClick={() => setOpenKey(group.key)}
                  >
                    <span className="cf-card-words">
                      {/* 卡面上的和式汉字要标注音：这一页并排的就是「长得像/读得像」的词，
                          读音本身常常就是区别所在（明後日 あさって / みょうごにち），
                          光摆汉字等于把区别藏起来。假名并排的那两类不标（它本来就是读音）。 */}
                      {groupWordParts(group).map((part, index) => (
                        <span key={`${part.text}-${index}`}>
                          {index > 0 && <i className="cf-card-sep"> / </i>}
                          {part.reading
                            ? <JapaneseWordRuby surface={part.text} reading={part.reading} />
                            : part.text}
                        </span>
                      ))}
                    </span>
                    <span className="cf-card-gloss">{cardSub(group)}</span>
                    {done && <span className="cf-card-badge">已掌握</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* 必须 portal 到 body。大卡的父容器 app-landscape-main 是 position:fixed,
          自成一个层叠上下文,遮罩的 z-index 只在那一层内部比较 —— 留在原地的话
          整个容器(z:auto)都排在 tabbar(z:9999)下面,「已掌握」按钮点不到。 */}
      {open && createPortal(
        <div className="cf-overlay" onClick={() => setOpenKey(null)}>
          <div className="cf-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="cf-sheet-head">
              <span className="cf-sheet-type">
                {(() => { const SheetIcon = TYPE_META[open.type].Icon; return <SheetIcon size={13} aria-hidden="true" />; })()}
                {TYPE_META[open.type].name}
              </span>
              <button className="cf-close" onClick={() => setOpenKey(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            {openReview && (
              <p className={`cf-sheet-hint cf-sheet-summary${openReview.level === "major" ? " is-major" : ""}`}>
                <b>{openReview.level === "major" ? "不能自由互换" : "通常可互换："}</b>
                {openReview.level !== "major" && openReview.summary}
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
                  {openNotes.get(String(member.id)) && (
                    <p className="cf-member-distinction">{openNotes.get(String(member.id))}</p>
                  )}
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
              aria-pressed={mastered.has(open.key)}
            >
              {mastered.has(open.key)
                ? <><Check size={16} /> 已掌握</>
                : "？掌握"}
            </button>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};
