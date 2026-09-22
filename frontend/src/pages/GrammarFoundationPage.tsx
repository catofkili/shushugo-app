import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Sticker } from "../components/CapybaraMascot";
import { grammarPoints } from "../data/grammar";
import {
  FOUNDATION_SECTION_LABELS,
  grammarFoundationRules,
  grammarFoundationSections,
  type GrammarFoundationSection
} from "../data/grammar-foundation";
import { useStudyTimer } from "../lib/useStudyTimer";
import type { JLPTLevel } from "../types/grammar";

const LEVELS: Array<"All" | JLPTLevel> = ["All", "N5", "N4", "N3", "N2", "N1"];

interface GrammarFoundationPageProps {
  onOpenGrammar: (id: string) => void;
  focusRuleId?: string | null;
}

// 卡片默认收着（小红书那种只露标题和一段话），深链 / 「动词全部变形」跳过来时要先把那张展开
const scrollToRule = (ruleId: string) => {
  const card = document.getElementById(ruleId);
  if (!card) return;
  const details = card.querySelector("details");
  if (details) details.open = true;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
};

export function GrammarFoundationPage({ onOpenGrammar, focusRuleId }: GrammarFoundationPageProps) {
  useStudyTimer(true);
  const [level, setLevel] = useState<"All" | JLPTLevel>("All");
  const [section, setSection] = useState<GrammarFoundationSection | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!focusRuleId) return;
    let scrollFrame = 0;
    const resetFrame = window.requestAnimationFrame(() => {
      setLevel("All");
      setSection("all");
      setQuery("");
      scrollFrame = window.requestAnimationFrame(() => scrollToRule(focusRuleId));
    });
    return () => {
      window.cancelAnimationFrame(resetFrame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [focusRuleId]);

  const points = useMemo(() => new Map(grammarPoints.map((point) => [point.id, point])), []);
  const shownRules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return grammarFoundationRules.filter((rule) => {
      if (level !== "All" && rule.level !== level) return false;
      if (section !== "all" && rule.section !== section) return false;
      if (!needle) return true;
      return [
        rule.title,
        rule.summary,
        ...rule.patterns,
        ...rule.checkpoints,
        ...(rule.tables ?? []).flatMap((table) => [table.title, ...table.headers, ...table.rows.flat()])
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [level, query, section]);

  return (
    <div className="space-y-5">
      <section className="dictionary-card space-y-3 rounded-3xl p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#81D8CF]">Grammar framework</p>
            <h1 className="jp-serif mt-1 text-2xl font-semibold text-[#343838] dark:text-[#f4efe4]">基础语法框架</h1>
          </div>
          <span className="shrink-0 rounded-full border border-[#81D8CF]/50 bg-[#81D8CF]/12 px-3 py-1 text-xs font-bold text-[#81D8CF]">
            {shownRules.length} / {grammarFoundationRules.length} 条
          </span>
        </div>
        <label className="focus-ring flex items-center gap-2 rounded-2xl border border-white/15 bg-[#373b3b] px-3 py-2.5 text-white/70">
          <Search size={17} className="shrink-0 text-[#81D8CF]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45"
            placeholder="搜索词类、活用、助词或句子结构"
            inputMode="search"
          />
        </label>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" aria-label="按等级筛选">
          <button
            onClick={() => {
              setLevel("All");
              setSection("all");
              setQuery("");
              window.requestAnimationFrame(() => scrollToRule("verb-conjugation-system"));
            }}
            className="focus-ring shrink-0 rounded-full bg-[#F5A623] px-3 py-1.5 text-xs font-bold !text-[#343838]"
          >
            动词全部变形 ↓
          </button>
          {LEVELS.map((item) => (
            <button
              key={item}
              onClick={() => setLevel(item)}
              className={`focus-ring shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${level === item ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
            >
              {item === "All" ? "全部等级" : item}
            </button>
          ))}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" aria-label="按主题筛选">
          <button
            onClick={() => setSection("all")}
            className={`focus-ring shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${section === "all" ? "border-[#F5A623] bg-[#F5A623] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
          >
            全部主题
          </button>
          {grammarFoundationSections.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`focus-ring shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${section === item.id ? "border-[#F5A623] bg-[#F5A623] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {/* 小红书式瀑布流：CSS columns 一行搞定，卡片各自按内容长高，不再被 grid 拉成一样高留一大片空。
          代价是顺序按列走（先填满左列再右列）——浏览用的清单，无所谓。 */}
      <div className="columns-2 gap-3 lg:columns-3">
        {shownRules.map((rule) => {
          const related = rule.relatedGrammarIds
            .map((id) => points.get(id))
            .filter((point): point is NonNullable<typeof point> => Boolean(point));
          return (
            <article id={rule.id} key={rule.id} className="dictionary-card mb-3 break-inside-avoid scroll-mt-6 rounded-2xl p-3.5 sm:p-4">
              <details className="group">
                <summary className="focus-ring cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <p className="text-[11px] font-bold tracking-[0.1em] text-[#81D8CF]">{FOUNDATION_SECTION_LABELS[rule.section]} · {rule.level}</p>
                  <h2 className="mt-1.5 text-base font-semibold leading-snug text-[#343838] dark:text-[#f4efe4]">{rule.title}</h2>
                  <p className="mt-2 text-[13px] leading-6 text-[#f9faf7] group-open:line-clamp-none line-clamp-5 dark:text-zinc-300">{rule.summary}</p>
                  <p className="mt-2 truncate text-[11px] font-bold text-white/45 group-open:hidden">
                    {rule.patterns.length} 条结构 · {rule.checkpoints.length} 个重点{rule.tables?.length ? ` · ${rule.tables.length} 张表` : ""} ▾
                  </p>
                </summary>

              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-white/10 bg-[#373b3b] p-2.5">
                  <p className="text-[11px] font-bold text-[#81D8CF]">基本结构</p>
                  <ul className="mt-1.5 space-y-1 text-[13px] leading-5 text-white/78">
                    {rule.patterns.map((pattern) => <li key={pattern}>{pattern}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#373b3b] p-2.5">
                  <p className="text-[11px] font-bold text-[#F5A623]">检查重点</p>
                  <ul className="mt-1.5 space-y-1 text-[13px] leading-5 text-white/78">
                    {rule.checkpoints.map((checkpoint) => <li key={checkpoint}>· {checkpoint}</li>)}
                  </ul>
                </div>
              </div>

              {/* 表格默认收着：一张 680px 宽的活用表摊在半屏宽的卡里只剩横向滚动条，展开再看 */}
              {rule.tables?.map((table) => (
                <details key={table.title} className="mt-3 rounded-xl border border-white/10 bg-[#373b3b] p-2.5">
                  <summary className="focus-ring cursor-pointer text-[13px] font-bold text-[#81D8CF]">{table.title}</summary>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                    <table className="min-w-[680px] w-full border-collapse text-left text-xs leading-5 text-white/78">
                      <thead className="bg-white/8 text-white/90">
                        <tr>
                          {table.headers.map((header) => (
                            <th key={header} className="border-b border-white/10 px-3 py-2 font-bold">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, rowIndex) => (
                          <tr key={`${table.title}-${rowIndex}`} className="align-top odd:bg-white/[0.03]">
                            {row.map((cell, cellIndex) => (
                              <td key={`${rowIndex}-${cellIndex}`} className="border-b border-white/8 px-3 py-2 last:border-b-0">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}

              <details className="mt-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
                <summary className="focus-ring cursor-pointer text-[13px] font-bold text-[#343838] dark:text-white/80">
                  对应语法卡（{related.length}）
                </summary>
                <div className="mt-2 space-y-1">
                  {related.map((point) => (
                    <button
                      key={point.id}
                      onClick={() => onOpenGrammar(point.id)}
                      className="focus-ring block w-full rounded-lg px-1.5 py-1 text-left text-[13px] font-bold text-[#81D8CF] underline decoration-[#81D8CF]/40 underline-offset-4 hover:bg-white/5 hover:text-white"
                    >
                      {point.level} · {point.title}
                    </button>
                  ))}
                </div>
              </details>
              </details>
            </article>
          );
        })}
      </div>

      {!shownRules.length && (
        <div className="dictionary-card rounded-3xl p-8 text-center text-sm text-[#f9faf7] dark:text-zinc-300">
          <Sticker name="empty-search" size={96} className="mx-auto mb-3" />
          {level !== "All" && !query && section === "all"
            ? `${level} 没有新增底层规则，看“全部等级”。`
            : "没有匹配的基础规则。"}
        </div>
      )}

      <footer className="dictionary-card rounded-3xl p-5 text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">分类参考
          <a className="inline-flex items-center gap-1 text-[#81D8CF] underline" href="https://www.jpf.go.jp/j/kansai/clip/ca/grammar_ppt.pdf" target="_blank" rel="noreferrer">日本国际交流基金 · 语法课程结构 <ExternalLink size={13} /></a>
        </p>
      </footer>
    </div>
  );
}
