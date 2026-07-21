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
