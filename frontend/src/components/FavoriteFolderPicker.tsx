import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, X } from "lucide-react";
import { createFavoriteFolder, lastFavoriteFolder, listFavoriteFolders, UNFILED_FOLDER } from "../lib/api";
import type { FavoriteFolder } from "../lib/api";

interface PickerRequest {
  title: string;
  current?: string;
  onPick: (folder: string) => void;
}

/**
 * 「收进哪个夹子」这一问只有一份实现：学习卡的星标、词库详情、语法列表、
 * 沉浸阅读、收藏页移动、完成页的顽固词一键收藏，六处共用这个 hook。
 *
 * ⚠️ **一个夹子都没建过时不弹窗**，直接进未分类。收藏这个动作本来是一下点完的，
 * 给从没用过分类的人加一次弹窗是纯粹的摩擦；夹子是他自己建出来的，建了才问。
 */
export const useFavoriteFolderPicker = () => {
  const [pending, setPending] = useState<PickerRequest | null>(null);

  const pickFolder = (request: PickerRequest) => {
    if (request.current === undefined && listFavoriteFolders().length === 0) {
      request.onPick(UNFILED_FOLDER);
      return;
    }
    setPending(request);
  };

  const picker = pending
    ? <FavoriteFolderSheet
        title={pending.title}
        current={pending.current}
        onClose={() => setPending(null)}
        onPick={(folder) => {
          setPending(null);
          pending.onPick(folder);
        }}
      />
    : null;

  return { pickFolder, picker };
};

export const FavoriteFolderSheet = ({
  title,
  current,
  onPick,
  onClose
}: {
  title: string;
  current?: string;
  onPick: (folder: string) => void;
  onClose: () => void;
}) => {
  const [folders, setFolders] = useState<FavoriteFolder[]>(() => listFavoriteFolders());
  const [lastFolder] = useState(() => lastFavoriteFolder());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  /**
   * ⚠️ 浮层开着的时候必须把按键吞掉。学习页的全局快捷键挂在 window 上：
   * 翻面前**按任意键**就翻面、翻面后 V/B/N/M 直接评分 —— 不吞的话，
   * 选收藏夹这一下会顺手给 FSRS 灌一次假作答。capture 阶段先于 window 上的冒泡监听。
   * 输入框里的按键要放行，否则「敲名字 + 回车建好」用不了。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      // stopImmediatePropagation 而不是 stopPropagation：按键的 target 通常是
      // body/window 自己，同一个节点上的其它监听器（学习页那个）只有它拦得住。
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const create = () => {
    const created = createFavoriteFolder(name);
    if (!created) return;
    setFolders(listFavoriteFolders());
    setName("");
    setCreating(false);
    onPick(created);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[72vh] w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#2f3333] p-4 shadow-2xl sm:max-w-sm sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-bold text-white">{title}</p>
          <button
            onClick={onClose}
            className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/8 text-white"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-2">
          {[{ name: UNFILED_FOLDER, count: -1 }, ...folders].map((folder) => (
            <button
              key={folder.name || "__unfiled__"}
              onClick={() => onPick(folder.name)}
              className={`focus-ring flex h-11 items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm font-bold ${
                current === folder.name
                  ? "border-[#81D8CF] bg-[#81D8CF]/18 text-[#81D8CF]"
                  : "border-white/15 bg-white/6 text-white/80"
              }`}
            >
              <span className="min-w-0 truncate">{folder.name || "未分类"}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {folder.name === lastFolder && current === undefined && (
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/45">上次</span>
                )}
                {folder.count >= 0 && <span className="text-xs text-white/45">{folder.count}</span>}
              </span>
            </button>
          ))}
        </div>

        {creating ? (
          <div className="mt-3 flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
              placeholder="收藏夹名字"
              className="focus-ring h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#343838] px-3 text-sm text-white outline-none"
            />
            <button
              onClick={create}
              className="focus-ring h-11 shrink-0 rounded-xl bg-[#81D8CF] px-4 text-sm font-bold !text-[#2f3333]"
            >
              建好收进
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="focus-ring mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 text-sm font-bold text-white/70"
          >
            <FolderPlus size={16} />
            新建收藏夹
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};
