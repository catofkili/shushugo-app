import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageDown, Loader2, MessageCircle, Share2, Sparkles, X } from "lucide-react";
import { Sticker } from "./CapybaraMascot";
import { isNativeApp, prepareWechatMomentsPost, saveImageToGallery, shareImage } from "../lib/share-image";

/**
 * 分享图预览：打卡图、词汇量结果图和周报长图共用；保存 / 分享 / 提示语都在这里，调用方只负责生成图片。
 *
 * - App（原生）：发好友 = 系统分享面板（安装了微信时可选「微信」再挑人）；
 *   朋友圈 = 存相册 + 拉起微信（没接 OpenSDK 之前只能到这一步）。
 * - 网页：没法从浏览器拉起微信，只给「保存图片」和「分享」（手机浏览器走 navigator.share，桌面退回下载）。
 *
 * ⚠️ 挂到 body 上、层级高于底栏：手机底栏 `AppNavigation` 是 zIndex 9999，
 * 原来的 `z-50` 弹窗在手机上两颗按钮正好被底栏压住（首次设定弹窗踩过同一个坑）。
 */
export function ShareImageSheet({ title, url, alt, blob, fileName, shareTitle, onClose }: {
  title: string;
  url: string;
  alt: string;
  blob: Blob;
  fileName: string;
  /** 系统分享面板里的标题 */
  shareTitle: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"save" | "share" | "moments" | null>(null);
  const [notice, setNotice] = useState("");
  const native = isNativeApp();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => element.offsetParent !== null);
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const run = async (kind: "save" | "share" | "moments") => {
    if (busy) return;
    setBusy(kind);
    setNotice("");
    try {
      if (kind === "save") {
        const result = await saveImageToGallery(blob, fileName);
        setNotice(result === "gallery" ? "已保存到相册 ✓" : "已开始下载 ✓");
      } else if (kind === "share") {
        const result = await shareImage(blob, fileName, shareTitle);
        if (result === "unsupported") setNotice("这个浏览器不支持直接分享，先保存图片再发吧");
      } else {
        await prepareWechatMomentsPost(blob, fileName);
        setNotice("已存到相册。若微信已安装会尝试打开；未跳转时请手动打开微信，在朋友圈选刚存的图。");
      }
    } catch {
      setNotice(kind === "share" ? "分享失败，再试一次" : "保存失败，请在 设置 > 收集日 里允许访问相册后重试");
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="share-sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div ref={dialogRef} className="share-sheet ds-card" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Sticker name="mood-happy" size={44} className="-my-1 shrink-0" />
          <p className="min-w-0 flex-1 text-base font-extrabold">{title}</p>
          <button type="button" onClick={onClose} className="ds-icon-btn focus-ring grid h-9 w-9 place-items-center rounded-full" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <img src={url} alt={alt} className="share-sheet-img" />
        {notice && <p className="share-sheet-notice" role="status">{notice}</p>}
        {native ? (
          <>
            <div className="share-sheet-wechat">
              <button type="button" onClick={() => void run("share")} disabled={busy !== null} className="ds-btn focus-ring disabled:opacity-60">
                {busy === "share" ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}发给微信好友
              </button>
              <button type="button" onClick={() => void run("moments")} disabled={busy !== null} className="ds-btn focus-ring disabled:opacity-60">
                {busy === "moments" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}去朋友圈发布
              </button>
            </div>
            <button type="button" onClick={() => void run("save")} disabled={busy !== null} className="ds-btn-soft focus-ring mt-2 w-full disabled:opacity-60">
              {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}保存到相册
            </button>
            <p className="share-sheet-hint">发给好友：微信已安装时可在分享面板里选择。朋友圈：先保存图片，再在微信里选图发布。</p>
          </>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void run("save")} disabled={busy !== null} className="ds-btn-soft focus-ring disabled:opacity-60">
              {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />}保存图片
            </button>
            <button type="button" onClick={() => void run("share")} disabled={busy !== null} className="ds-btn focus-ring disabled:opacity-60">
              {busy === "share" ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}分享
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
