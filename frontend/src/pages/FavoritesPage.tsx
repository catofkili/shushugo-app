import { useEffect, useState } from "react";
import { BookOpenText, Brain, Star, Trash2 } from "lucide-react";
import { FavoriteItem, getFavoriteItems, toggleFavorite } from "../lib/api";

type FavoriteFilter = "all" | "word" | "grammar";

interface FavoritesPageProps {
  onOpenGrammar: (id: string) => void;
}

const filters: { id: FavoriteFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "word", label: "单词" },
  { id: "grammar", label: "语法" }
];

export const FavoritesPage = ({ onOpenGrammar }: FavoritesPageProps) => {
  const [filter, setFilter] = useState<FavoriteFilter>("all");
  const [items, setItems] = useState<FavoriteItem[]>([]);

  const load = () => setItems(getFavoriteItems(filter));

  useEffect(() => {
    load();
  }, [filter]);

  const remove = (item: FavoriteItem) => {
    toggleFavorite(item.type, item.id);
    load();
  };

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <div className="dictionary-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Favorites</p>
            <h1 className="mt-1 text-2xl font-semibold">收藏</h1>
          </div>
          <Star className="text-[#81D8CF]" size={24} fill="currentColor" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-white/15 bg-[#81D8CF]/10 p-1">
          {filters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`focus-ring h-10 rounded-xl text-sm font-bold ${filter === item.id ? "bg-[#81D8CF] !text-[#343838]" : "text-white/72 hover:bg-white/8"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = item.type === "word" ? BookOpenText : Brain;
            return (
              <article key={`${item.type}-${item.id}`} className="dictionary-card rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/14 text-[#81D8CF]">
                    <Icon size={21} />
                  </span>
                  <button
                    onClick={() => item.type === "grammar" && onOpenGrammar(item.id)}
                    className="focus-ring min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/55">{item.type === "word" ? "单词" : "语法"}</span>
                      {item.meta && <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/55">{item.meta}</span>}
                    </div>
                    <h2 className="jp-serif mt-3 text-2xl font-semibold leading-tight">{item.title}</h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/68">{item.subtitle}</p>
                  </button>
                  <button
                    onClick={() => remove(item)}
                    className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/10 text-white/62 hover:bg-[#81D8CF]/15"
                    title="取消收藏"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="dictionary-card rounded-2xl p-8 text-center">
          <Star className="mx-auto text-white/35" size={32} />
          <p className="mt-4 text-lg font-bold">还没有收藏</p>
          <p className="mt-2 text-sm text-white/55">在单词卡片或语法卡片上点星标，就会收进这里。</p>
        </div>
      )}
    </section>
  );
};
