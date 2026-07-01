import { useEffect, useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { JapaneseRuby } from "../components/JapaneseRuby";
import { JLPTLevel } from "../types/grammar";

interface GrammarReviewProps {
  selectedLevel: "All" | JLPTLevel;
  onOpenGrammar?: (id: string) => void;
}

interface ReviewItem {
  id: string;
  pattern: string;
  meaning: string;
  level: string;
  formation: string;
  score: number;
  seen: number;
  forgot: number;
  fuzzy: number;
  right: number;
}

// 按分数把"不熟悉程度"分档:分越低越不熟
function familiarity(score: number): { label: string; cls: string } {
  if (score <= -6) return { label: "很陌生", cls: "border-red-400/40 bg-red-400/15 text-red-200" };
  if (score <= 0) return { label: "陌生", cls: "border-orange-400/40 bg-orange-400/15 text-orange-200" };
  if (score <= 6) return { label: "学习中", cls: "border-yellow-300/40 bg-yellow-300/15 text-yellow-100" };
  if (score <= 12) return { label: "渐熟", cls: "border-[#81D8CF]/40 bg-[#81D8CF]/15 text-[#81D8CF]" };
  return { label: "熟悉", cls: "border-green-400/40 bg-green-400/15 text-green-200" };
}

export const GrammarReview = ({ selectedLevel, onOpenGrammar }: GrammarReviewProps) => {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/grammar/review?level=${encodeURIComponent(selectedLevel)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败：${res.status}`);
        return res.json();
      })
      .then((data: { items: ReviewItem[] }) => {
        if (active) setItems(data.items ?? []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "复习列表读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedLevel]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-md border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-6 text-white">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-1 shrink-0" />
          <div>
            <p className="font-bold">复习板块暂时不可用</p>
            <p className="mt-2 text-sm text-white/70">{error}</p>
            <p className="mt-1 text-xs text-white/50">请确认后端 server.py 正在运行。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="dictionary-card rounded-md p-4">
        <div className="flex items-center gap-2">
          <RotateCcw size={18} className="text-[#81D8CF]" />
          <h2 className="text-base font-bold text-white">语法复习</h2>
        </div>
        <p className="mt-1 text-xs text-white/55">
          按不熟悉程度排序,越陌生的越靠前{selectedLevel === "All" ? "" : `（${selectedLevel}）`}。共 {items.length} 条。
        </p>
      </div>

      {loading ? (
        <div className="rounded-md border border-white/15 bg-[#3c3f3f] p-6 text-center text-sm text-white/60">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-white/15 bg-[#3c3f3f] p-6 text-center text-sm text-white/60">
          这个等级还没有学习记录,先去「语法练习」做几题吧。
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const fam = familiarity(item.score);
            return (
              <button
                key={item.id}
                onClick={() => onOpenGrammar?.(item.id)}
                className="focus-ring w-full rounded-md border border-white/15 bg-[#3c3f3f] p-3 text-left transition hover:bg-[#444848]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="jp text-lg font-bold text-white">
                      <JapaneseRuby text={item.pattern} />
                    </p>
                    <p className="mt-1 text-sm text-white/72">{item.meaning}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-sm border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/55">{item.level}</span>
                    <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-bold ${fam.cls}`}>{fam.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-white/45">
                  <span>分数 {item.score}</span>
                  <span>看过 {item.seen}</span>
                  <span>忘 {item.forgot}</span>
                  <span>对 {item.right}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
