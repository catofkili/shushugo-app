import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  allKanjiReadingUsage,
  clauseText,
  kanjiReadingUsageFor,
  loadKanjiReadingUsage,
  readingLine,
  type KanjiCharUsage
} from "../lib/kanji-reading-usage";

/**
 * 一字多音 —— 一个汉字的几个读音各自什么时候用。
 *
 * 中文母语者认得字,盲区在读音,而多音字是这个盲区里最贵的一块:
 * 一月 いちがつ / 月曜日 げつようび / 三日月 みかづき,同一个字三个音。
 *
 * ── 为什么默认只摆「有具体规律」的那批 ──
 * 520 个多音字里有 145 个是纯音训分工(汉语复合词读音读,其余读训读),
 * 它们的说明**逐字相同**。一张张摊开等于把同一句话说一百多遍 ——
 * 那句话在顶上的通则卡里说一次就够了。
 * 关掉开关能看全部,但默认不该让重复内容淹掉真正要记的那批。
 *
 * 刻意不接 FSRS、不进当日计划:这是查阅用的说明表,不是题。
 * 想练读音走「汉字读音」模式,那边考的才是读音本身。
 */

const LEVEL_NAMES = ["N5", "N4", "N3", "N2", "N1", "无级"];

export const KanjiReadingUsagePage = () => {
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const [onlySpecific, setOnlySpecific] = useState(true);
  const [query, setQuery] = useState("");
  const [openChar, setOpenChar] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadKanjiReadingUsage().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const all = ready ? allKanjiReadingUsage() : [];

  const shown = useMemo(() => {
    if (!ready) return [] as KanjiCharUsage[];
    const needle = query.trim();
    return all.filter((entry) => {
      if (needle) {
        // 搜索既要认汉字,也要认读音 —— 想不起字长什么样、只记得读音的时候才是真需要查
        if (!entry.char.includes(needle) && !entry.readings.some((r) => r.base.includes(needle))) return false;
      }
      if (level !== null && entry.levelRank !== level) return false;
      // 搜了具体的字/读音就别再拿「只看通则说不清的」把它挡掉 —— 查表是明确的指名,
      // 这时返回「没有匹配的字」是在骗人:那个字明明在表里。
      if (!needle && onlySpecific && !entry.hasSpecific) return false;
      return true;
    });
  }, [all, ready, query, level, onlySpecific]);

  const handWritten = all.filter((entry) => entry.hasManual).length;
  const open = openChar ? kanjiReadingUsageFor(openChar) : null;

  if (!ready) return <p className="cf-loading">正在加载读音表…</p>;

  return (
    <section className="cf-page">
      <header className="cf-head">
        <div>
          <p className="cf-kick">Readings</p>
          <h1 className="cf-title">一字多音</h1>
        </div>
        <p className="cf-count">
          <b>{shown.length}</b> 个字 · 人写的说明 {handWritten}
        </p>
      </header>

      {/* 通则说一次就够。145 个字的说明是同一句话，摊开重复一百多遍才是噪音。 */}
      <details className="kr-rule">
        <summary>
          <b>先看这条通则</b>
          <small>大半的音训分工靠它就够了</small>
        </summary>
        <p>
          汉语复合词里读 <b>音读</b>（学生 がくせい・食堂 しょくどう）；单独用、带送假名，
          或在和语词里读 <b>训读</b>（生きる・近道・本屋）。
        </p>
        <p className="kr-rule-more">
          下面摆出来的是<b>这条通则说不清</b>的那批：跟数字走的、靠送假名分的、
          只在两三个词里出现的，以及两个音读撞在一起、只能一条条写的 {handWritten} 个。
        </p>
      </details>

      <div className="kr-bar">
        <input
          className="kr-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="查汉字或读音，如 月 / げつ"
          inputMode="search"
        />
        <div className="kr-chips">
          <button className={level === null ? "is-on" : ""} onClick={() => setLevel(null)}>全部</button>
          {LEVEL_NAMES.slice(0, 5).map((name, rank) => (
            <button key={name} className={level === rank ? "is-on" : ""} onClick={() => setLevel(rank)}>
              {name}
            </button>
          ))}
        </div>
        <label className="kr-toggle">
          <input
            type="checkbox"
            checked={onlySpecific}
            onChange={(event) => setOnlySpecific(event.target.checked)}
          />
          只看通则说不清的
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="cf-loading">没有匹配的字</p>
      ) : (
        <div className="kr-grid">
          {shown.map((entry) => (
            <button key={entry.char} className="kr-card" onClick={() => setOpenChar(entry.char)}>
              <b className="jp-serif kr-card-char">{entry.char}</b>
              <span className="jp kr-card-readings">{readingLine(entry)}</span>
              <span className="kr-card-level">{LEVEL_NAMES[entry.levelRank] ?? ""}</span>
              {entry.hasManual && <span className="kr-card-badge" title="人工说明">✍️</span>}
            </button>
          ))}
        </div>
      )}

      {/* portal 到 body 的理由同疑难辨析：父容器 position:fixed 自成层叠上下文，
          留在原地整个容器都排在 tabbar 下面，遮罩点不动。 */}
      {open && createPortal(
        <div className="cf-overlay" onClick={() => setOpenChar(null)}>
          <div className="cf-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="cf-sheet-head">
              <span className="cf-sheet-type">
                <b className="jp-serif kr-sheet-char">{open.char}</b>
                {open.readings.length} 个读音 · {LEVEL_NAMES[open.levelRank] ?? ""}
              </span>
              <button className="cf-close" onClick={() => setOpenChar(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            {open.summary && <p className="cf-sheet-hint">{open.summary}</p>}

            <div className="cf-members">
              {open.readings.map((reading) => (
                <div key={reading.base} className={`cf-member${reading.manual ? " kr-member-manual" : ""}`}>
                  <div className="cf-member-head">
                    <b className="jp-serif cf-member-word">{reading.base}</b>
                    <span className="cf-member-kana">{reading.kinds.includes("on") ? "音读" : "训读"}</span>
                    <span className="cf-member-level">{reading.count} 词</span>
                  </div>
                  <p className="cf-member-meaning">{clauseText(reading)}</p>
                  {/* 例词一行一个,带释义 —— 「读哪个音」判据那行已经说了,
                      这里回答的是另一个问题:这几个词各是什么意思。
                      冷える(变冷) / 冷ます(晾凉) 的区别只有这一列说得出来。 */}
                  <ul className="kr-examples">
                    {reading.examples.map((example) => (
                      <li key={example.surface}>
                        <b className="jp">{example.surface}</b>
                        <span className="jp kr-example-kana">{example.kana}</span>
                        {example.meaning && <span className="kr-example-gloss">{example.meaning}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};
