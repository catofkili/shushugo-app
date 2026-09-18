import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
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

const scrollToRule = (ruleId: string) => {
  document.getElementById(ruleId)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <header className="dictionary-card rounded-3xl p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#81D8CF]">Grammar framework</p>
        <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="jp-serif text-4xl font-semibold text-[#343838] dark:text-[#f4efe4]">基础语法框架</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">
              这里只讲能生成、拆解其他句型的底层规则。基础规则主要在 N5、N4 首次建立，N3 到 N1 继续使用；原因、条件、让步等具体表达仍在语法辞典。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setLevel("All");
                setSection("all");
                setQuery("");
                window.requestAnimationFrame(() => scrollToRule("verb-conjugation-system"));
              }}
              className="focus-ring rounded-full bg-[#F5A623] px-4 py-2 text-sm font-bold !text-[#343838]"
            >
              动词全部变形（22 条）↓
            </button>
            <span className="rounded-full border border-[#81D8CF]/50 bg-[#81D8CF]/12 px-3 py-1.5 text-xs font-bold text-[#81D8CF]">
              {shownRules.length} / {grammarFoundationRules.length} 条规则
            </span>
          </div>
        </div>
      </header>

      <section className="dictionary-card space-y-4 rounded-3xl p-4 sm:p-5">
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
        <div className="flex flex-wrap gap-2" aria-label="按等级筛选">
          {LEVELS.map((item) => (
            <button
              key={item}
              onClick={() => setLevel(item)}
              className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-bold transition ${level === item ? "border-[#81D8CF] bg-[#81D8CF] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
            >
              {item === "All" ? "全部等级" : item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="按主题筛选">
          <button
            onClick={() => setSection("all")}
            className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-bold transition ${section === "all" ? "border-[#F5A623] bg-[#F5A623] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
          >
            全部主题
          </button>
          {grammarFoundationSections.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-bold transition ${section === item.id ? "border-[#F5A623] bg-[#F5A623] !text-[#343838]" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {shownRules.map((rule) => {
          const related = rule.relatedGrammarIds
            .map((id) => points.get(id))
            .filter((point): point is NonNullable<typeof point> => Boolean(point));
          return (
            <article id={rule.id} key={rule.id} className="dictionary-card scroll-mt-6 rounded-3xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[0.14em] text-[#81D8CF]">{FOUNDATION_SECTION_LABELS[rule.section]} · 首次学习 {rule.level}</p>
                  <h2 className="mt-2 text-xl font-semibold text-[#343838] dark:text-[#f4efe4]">{rule.title}</h2>
                </div>
                <span className="rounded-full border border-white/15 px-2 py-1 text-[11px] font-bold text-[#343838]/55 dark:text-white/55">框架</span>
              </div>
              <p className="mt-3 text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">{rule.summary}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#373b3b] p-3">
                  <p className="text-xs font-bold text-[#81D8CF]">基本结构</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-white/78">
                    {rule.patterns.map((pattern) => <li key={pattern}>{pattern}</li>)}
                  </ul>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#373b3b] p-3">
                  <p className="text-xs font-bold text-[#F5A623]">检查重点</p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-6 text-white/78">
                    {rule.checkpoints.map((checkpoint) => <li key={checkpoint}>· {checkpoint}</li>)}
                  </ul>
                </div>
              </div>

              {rule.tables?.map((table) => (
                <section key={table.title} className="mt-4 rounded-2xl border border-white/10 bg-[#373b3b] p-3">
                  <h3 className="text-sm font-bold text-[#81D8CF]">{table.title}</h3>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
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
                </section>
              ))}

              <details className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                <summary className="focus-ring cursor-pointer text-sm font-bold text-[#343838] dark:text-white/80">
                  查看对应语法卡（{related.length} 条）
                </summary>
                <div className="mt-3 space-y-2">
                  {related.map((point) => (
                    <button
                      key={point.id}
                      onClick={() => onOpenGrammar(point.id)}
                      className="focus-ring block w-full rounded-xl px-2 py-1 text-left text-sm font-bold text-[#81D8CF] underline decoration-[#81D8CF]/40 underline-offset-4 hover:bg-white/5 hover:text-white"
                    >
                      {point.level} · {point.title} → 打开语法卡
                    </button>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
      </div>

      {!shownRules.length && (
        <div className="dictionary-card rounded-3xl p-8 text-center text-sm text-[#f9faf7] dark:text-zinc-300">
          {level !== "All" && !query && section === "all"
            ? `${level} 没有新增底层规则；请查看“全部等级”复用此前建立的基础，具体高级表达留在语法辞典。`
            : "没有匹配的基础规则。"}
        </div>
      )}

      <footer className="dictionary-card rounded-3xl p-5 text-sm leading-7 text-[#f9faf7] dark:text-zinc-300">
        <p className="font-bold text-[#343838] dark:text-[#f4efe4]">内容说明</p>
        <p className="mt-2">分类边界参考日本国际交流基金对句末与文体、助词、动词活用、态、自他动词、待遇表达、句子连接和情态的整理；中文说明和结构例子由本项目重新撰写。</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <a className="inline-flex items-center gap-1 text-[#81D8CF] underline" href="https://www.jpf.go.jp/j/kansai/clip/ca/grammar_ppt.pdf" target="_blank" rel="noreferrer">日本国际交流基金 · 语法课程结构 <ExternalLink size={13} /></a>
        </p>
      </footer>
    </div>
  );
}
