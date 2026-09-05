import { useEffect, useState } from "react";
import { BookOpenText, Brain, FolderPlus, Pencil, Star, Trash2 } from "lucide-react";
import { JapaneseRuby } from "../components/JapaneseRuby";
import {
  createFavoriteFolder,
  deleteFavoriteFolder,
  FavoriteItem,
  getFavoriteItems,
  listFavoriteFolders,
  renameFavoriteFolder,
  setFavoriteFolder,
  toggleFavorite,
  unfiledFavoriteCount,
  UNFILED_FOLDER
} from "../lib/api";
import type { FavoriteFolder } from "../lib/api";
import { useFavoriteFolderPicker } from "../components/FavoriteFolderPicker";
import { getGrammarTitleFurigana } from "../lib/grammar-title-furigana";

type FavoriteFilter = "all" | "word" | "grammar";

interface FavoritesPageProps {
  onOpenGrammar: (id: string) => void;
  /** 收藏夹里的词直接开一场（走自选清单通道，和词库勾词是同一条）。 */
  onStudyPicked?: (wordIds: number[]) => void;
}

const filters: { id: FavoriteFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "word", label: "单词" },
  { id: "grammar", label: "语法" }
];

/** 收藏夹筛选的三种取值：所有夹子 / 未分类 / 某个夹名。 */
const ALL_FOLDERS = "__all__";

export const FavoritesPage = ({ onOpenGrammar, onStudyPicked }: FavoritesPageProps) => {
  const [filter, setFilter] = useState<FavoriteFilter>("all");
  const [folder, setFolder] = useState<string>(ALL_FOLDERS);
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [unfiled, setUnfiled] = useState(0);
  const [items, setItems] = useState<FavoriteItem[]>([]);
  // 新建和改名共用同一个行内输入框：window.prompt 在 WKWebView 里是个没样式的系统框，
  // 而这一排 chip 本来就有输入框可用。
  const [editing, setEditing] = useState<{ mode: "create" | "rename"; value: string } | null>(null);
  const [error, setError] = useState("");
  /** 语法收藏按 grammar.ts 的字符串 id 存，词库表里查不到，只能回 grammar.ts 补。
   *  按需 import：只有真有语法收藏时才拉那份 1.2MB 的语法数据。 */
  const [grammarInfo, setGrammarInfo] = useState<Map<string, { title: string; meaning: string; level: string }>>(new Map());
  const { pickFolder, picker } = useFavoriteFolderPicker();

  // 读失败必须说出来。三个 setState 里任何一个抛异常，页面就会停在初始状态
  // ——「还没有收藏」——，那是一句关于用户数据的假话，而收藏页的全部职责就是把
  // 存下来的东西如实摆出来。
  const load = () => {
    try {
      setItems(getFavoriteItems(filter, folder === ALL_FOLDERS ? undefined : folder));
      setFolders(listFavoriteFolders());
      setUnfiled(unfiledFavoriteCount());
      setError("");
    } catch (err) {
      console.error("[favorites] 读取收藏失败", err);
      setError(err instanceof Error ? err.message : "读取收藏失败");
    }
  };

  useEffect(() => {
    load();
  }, [filter, folder]);

  useEffect(() => {
    if (!items.some((item) => item.type === "grammar" && !item.title)) return;
    let alive = true;
    void import("../data/grammar").then(({ grammarPoints }) => {
      if (!alive) return;
      setGrammarInfo(new Map(grammarPoints.map((point) => [
        point.id,
        { title: point.title, meaning: point.meaning, level: point.level }
      ])));
    });
    return () => { alive = false; };
  }, [items]);

  const remove = (item: FavoriteItem) => {
    toggleFavorite(item.type, item.id);
    load();
  };

  const move = (item: FavoriteItem) => {
    pickFolder({
      title: `把「${item.title || item.id}」移到`,
      current: item.folder,
      onPick: (target) => {
        setFavoriteFolder(item.type, item.id, target);
        load();
      }
    });
  };

  const submitEditing = () => {
    if (!editing) return;
    const next = editing.mode === "create"
      ? createFavoriteFolder(editing.value)
      : renameFavoriteFolder(folder, editing.value);
    setEditing(null);
    if (next) setFolder(next);
    else load();
  };

  const removeCurrent = () => {
    if (!window.confirm(`删掉收藏夹「${folder}」？里面的收藏会回到未分类，不会丢。`)) return;
    deleteFavoriteFolder(folder);
    setFolder(ALL_FOLDERS);
  };

  const folderChips: { key: string; label: string; count: number | null }[] = [
    { key: ALL_FOLDERS, label: "所有收藏", count: null },
    { key: UNFILED_FOLDER, label: "未分类", count: unfiled },
    ...folders.map((entry) => ({ key: entry.name, label: entry.name, count: entry.count }))
  ];
  const isCustomFolder = folder !== ALL_FOLDERS && folder !== UNFILED_FOLDER;
  // 收藏夹里的词能直接开一场，否则分好类的收藏只是一张列表。
  // 走的是自选清单那条通道（不看到期、不进今日计划），和词库勾词完全一样。
  const wordIdsInView = items.filter((item) => item.type === "word").map((item) => Number(item.id));

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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {folderChips.map((chip) => (
            <button
              key={chip.key || "__unfiled__"}
              onClick={() => setFolder(chip.key)}
              className={`focus-ring h-9 rounded-full border px-3 text-xs font-bold ${
                folder === chip.key
                  ? "border-[#81D8CF] bg-[#81D8CF]/18 text-[#81D8CF]"
                  : "border-white/15 bg-white/6 text-white/70"
              }`}
            >
              {chip.label}{chip.count === null ? "" : ` ${chip.count}`}
            </button>
          ))}
          {editing === null ? (
            <button
              onClick={() => setEditing({ mode: "create", value: "" })}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-white/25 px-3 text-xs font-bold text-white/65"
            >
              <FolderPlus size={14} />
              新建收藏夹
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <input
                autoFocus
                value={editing.value}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitEditing();
                  if (event.key === "Escape") setEditing(null);
                }}
                placeholder={editing.mode === "create" ? "收藏夹名字" : "改成什么名字"}
                className="focus-ring h-9 w-36 rounded-full border border-white/15 bg-[#343838] px-3 text-xs text-white outline-none"
              />
              <button
                onClick={submitEditing}
                className="focus-ring h-9 rounded-full bg-[#81D8CF] px-3 text-xs font-bold !text-[#2f3333]"
              >
                {editing.mode === "create" ? "建好" : "改好"}
              </button>
            </span>
          )}
          {onStudyPicked && wordIdsInView.length > 0 && (
            <button
              onClick={() => onStudyPicked(wordIdsInView)}
              className="focus-ring h-9 rounded-full bg-[#81D8CF] px-3 text-xs font-bold !text-[#2f3333]"
            >
              学这 {wordIdsInView.length} 个词 →
            </button>
          )}
          {isCustomFolder && (
            <>
              <button onClick={() => setEditing({ mode: "rename", value: folder })} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/6 text-white/62" title="收藏夹改名">
                <Pencil size={14} />
              </button>
              <button onClick={removeCurrent} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/6 text-white/62" title="删除收藏夹">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-[#E8971C]/45 bg-[#E8971C]/12 p-4 text-sm text-white">
          <p className="font-bold">收藏没读出来</p>
          <p className="mt-1 text-white/70">{error}</p>
        </div>
      )}

      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = item.type === "word" ? BookOpenText : Brain;
            const fallback = item.title ? null : grammarInfo.get(item.id);
            const title = item.title || fallback?.title || item.id;
            const subtitle = item.subtitle || fallback?.meaning || "";
            const meta = item.meta || fallback?.level || "";
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
                      {meta && <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/55">{meta}</span>}
                    </div>
                    <h2 className="jp-serif mt-3 text-2xl font-semibold leading-tight">
                      {item.type === "grammar" ? <JapaneseRuby text={title} furigana={getGrammarTitleFurigana(item.id)} /> : title}
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/68">{subtitle}</p>
                  </button>
                  <div className="grid shrink-0 gap-2">
                    <button
                      onClick={() => remove(item)}
                      className="focus-ring grid h-9 w-9 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/10 text-white/62 hover:bg-[#81D8CF]/15"
                      title="取消收藏"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => move(item)}
                  className="focus-ring mt-3 h-8 rounded-full border border-white/15 bg-white/6 px-3 text-xs font-bold text-white/62"
                  title="换个收藏夹"
                >
                  {item.folder || "未分类"} ▸
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="dictionary-card rounded-2xl p-8 text-center">
          <Star className="mx-auto text-white/35" size={32} />
          <p className="mt-4 text-lg font-bold">{folder === ALL_FOLDERS ? "还没有收藏" : "这个收藏夹是空的"}</p>
          <p className="mt-2 text-sm text-white/55">在单词卡片或语法卡片上点星标，就会收进这里。</p>
        </div>
      )}
      {picker}
    </section>
  );
};
