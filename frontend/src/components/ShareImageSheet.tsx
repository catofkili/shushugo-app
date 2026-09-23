import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ImageDown, Loader2, Share2, X } from "lucide-react";
import { Sticker } from "./CapybaraMascot";

/**
 * 分享图预览：图 + 「保存到相册」「发给好友」。打卡图和词汇量图共用这一份（原来两处各抄一个深色弹窗）。
 *
 * ⚠️ 挂到 body 上、层级高于底栏：手机底栏 `AppNavigation` 是 zIndex 9999，
 * 原来的 `z-50` 弹窗在手机上两颗按钮正好被底栏压住（首次设定弹窗踩过同一个坑）。
 */
export function ShareImageSheet({ title, url, alt, notice, busy, onSave, onShare, onClose }: {
  title: string;
  url: string;
  alt: string;
  notice: string;
  busy: string | null;
  onSave: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="share-sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="share-sheet ds-card" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Sticker name="mood-happy" size={44} className="-my-1 shrink-0" />
          <p className="min-w-0 flex-1 text-base font-extrabold">{title}</p>
          <button type="button" onClick={onClose} className="ds-icon-btn focus-ring grid h-9 w-9 place-items-center rounded-full" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <img src={url} alt={alt} className="share-sheet-img" />
        {notice && <p className="share-sheet-notice" role="status">{notice}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onSave} disabled={busy !== null} className="ds-btn-soft focus-ring disabled:opacity-60">
            {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}保存到相册
          </button>
          <button type="button" onClick={onShare} disabled={busy !== null} className="ds-btn focus-ring disabled:opacity-60">
            {busy === "share" ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}发给好友
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
