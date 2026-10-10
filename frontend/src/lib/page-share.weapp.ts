import { createContext, useContext, useEffect } from "react";
import type { PageShare } from "./page-share";

// 有 Provider 的页面（组队 / 对战，页面入口自己 useShareAppMessage）走 Provider；
// 其余页面把卡片挂到原生页面实例上，由 taro-spike-2/src/app.tsx 的 modifyPageObject 兜底挂的 onShareAppMessage 读 this。
// ⚠️ 别改成模块里的 Map：这个模块主包（app.tsx）和 lazy 分包各打一份，两份 Map 互相看不见，兜底永远读到空表。
export const PageShareContext = createContext<((share: PageShare | null) => void) | null>(null);
type SharePage = { __pageShare?: PageShare | null };
// 不 import @tarojs/taro：frontend 没装它（tsc / vitest 会找不到）。原生页面栈顶就是当前页。
declare const getCurrentPages: undefined | (() => SharePage[]);
const currentPage = () => {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  return pages[pages.length - 1];
};
export const DEFAULT_PAGE_SHARE: PageShare = { title: "收集日 · 每天学一点日语", path: "/pages/home/index" };
export const pageShareFor = (page: SharePage) => page.__pageShare ?? DEFAULT_PAGE_SHARE;

export function usePageShare(share: PageShare | null) {
  const setShare = useContext(PageShareContext);
  const title = share?.title;
  const path = share?.path;
  useEffect(() => {
    const share = title && path ? { title, path } : null;
    if (setShare) {
      setShare(share);
      return () => setShare(null);
    }
    if (!share) return;
    // 页面实例在登记时就记下：清理发生在离开页面时，那时栈顶已经是下一页了。
    const page = currentPage();
    if (!page) return;
    page.__pageShare = share;
    return () => { if (page.__pageShare === share) page.__pageShare = null; };
  }, [title, path, setShare]);
}

// plugin-html 保留 button 的 openType；Taro 的分享生命周期按按钮 id 补回 dataset。
// 直接读被点击按钮的数据，避免 tap / 分享回调顺序不同而发成另一张卡片。
export const pageShareButtonProps = (share: PageShare, _onClick: () => void) => ({
  openType: "share",
  "data-share-title": share.title,
  "data-share-path": share.path
});

export function shareAppMessage(event: { from?: string; target?: { dataset?: Record<string, unknown> } }, fallback: PageShare): PageShare {
  const data = event.from === "button" ? event.target?.dataset : undefined;
  return typeof data?.shareTitle === "string" && typeof data.sharePath === "string"
    ? { title: data.shareTitle, path: data.sharePath } : fallback;
}
