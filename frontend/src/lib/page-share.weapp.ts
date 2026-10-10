import { createContext, useContext, useEffect } from "react";
import type { PageShare } from "./page-share";

export const PageShareContext = createContext<(share: PageShare | null) => void>(() => undefined);

export function usePageShare(share: PageShare | null) {
  const setShare = useContext(PageShareContext);
  const title = share?.title;
  const path = share?.path;
  useEffect(() => {
    setShare(title && path ? { title, path } : null);
    return () => setShare(null);
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
