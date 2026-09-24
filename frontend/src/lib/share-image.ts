import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Media } from "@capacitor-community/media";
import { Share } from "@capacitor/share";

// 分享图的落地动作:原生平台走相册 / 系统分享面板(微信、QQ 等以
// Share Extension 出现在面板里),Web 退回下载 / navigator.share。

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });

// Share / Media 都只认本地文件 URI,先落到 Cache(系统可随时回收,不占用户空间)。
const writeShareCache = async (blob: Blob, fileName: string): Promise<string> => {
  const data = await blobToBase64(blob);
  const result = await Filesystem.writeFile({
    path: `share/${fileName}`,
    data,
    directory: Directory.Cache,
    recursive: true
  });
  return result.uri;
};

const downloadInBrowser = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export type SaveImageResult = "gallery" | "download";

export const saveImageToGallery = async (blob: Blob, fileName: string): Promise<SaveImageResult> => {
  if (Capacitor.isNativePlatform()) {
    const uri = await writeShareCache(blob, fileName);
    // 不传 albumIdentifier:iOS 会走「仅添加」相册权限,存入相机胶卷
    await Media.savePhoto({ path: uri });
    return "gallery";
  }
  downloadInBrowser(blob, fileName);
  return "download";
};

export type ShareImageResult = "shared" | "canceled" | "unsupported";
/** 纯文字分享的结果多一种「已复制」：Web 上没有分享面板时退回剪贴板。 */
export type ShareTextResult = ShareImageResult | "copied";

const isShareCanceled = (error: unknown) =>
  error instanceof Error && /cancel|abort/i.test(error.message || error.name);

export const shareImage = async (blob: Blob, fileName: string, title: string): Promise<ShareImageResult> => {
  if (Capacitor.isNativePlatform()) {
    const uri = await writeShareCache(blob, fileName);
    try {
      await Share.share({ files: [uri], title });
      return "shared";
    } catch (error) {
      if (isShareCanceled(error)) return "canceled";
      throw error;
    }
  }
  const file = new File([blob], fileName, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (isShareCanceled(error)) return "canceled";
      throw error;
    }
  }
  return "unsupported";
};

/**
 * 分享一段文字（词汇量结果这类没有图的场景）。
 *
 * 原生走系统分享面板，Web 优先 navigator.share，都没有就退回剪贴板 ——
 * 「没反应」比「复制好了」难受得多。
 */
export const shareText = async (text: string, title: string): Promise<ShareTextResult> => {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text });
      return "shared";
    } catch (error) {
      if (isShareCanceled(error)) return "canceled";
      throw error;
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (error) {
      if (isShareCanceled(error)) return "canceled";
      // 分享失败仍然可以退回剪贴板，别让用户白点一下
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "unsupported";
  }
};

/**
 * 「发到朋友圈」：先把图存进相册，再拉起微信，用户在朋友圈里选这张图发。
 *
 * ⚠️ 这是没有微信 OpenSDK 时能做到的最近一步。直接把图塞进朋友圈 / 好友会话（WXApi sendReq，
 * WXSceneTimeline / WXSceneSession）要开放平台「移动应用」AppID + Universal Link + OpenSDK 原生桥接，
 * 和 App 微信登录是同一批前置条件（docs/WECHAT_APP_LOGIN.md），都还没做。接上之后把这里换成直接分享。
 *
 * 拉起微信用 `weixin://`：Capacitor 的 WebView 遇到非本应用的顶层跳转会交给 UIApplication.open
 * （WebViewDelegationHandler），不需要在 LSApplicationQueriesSchemes 里登记（那个只管 canOpenURL）。
 * 代价是判断不了用户装没装微信 —— 没装的话什么都不会发生，所以界面上一定要先说「已存到相册」。
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export const prepareWechatMomentsPost = async (blob: Blob, fileName: string): Promise<SaveImageResult> => {
  const saved = await saveImageToGallery(blob, fileName);
  if (saved === "gallery") window.location.href = "weixin://";
  return saved;
};
