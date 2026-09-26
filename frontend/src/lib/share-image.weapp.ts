declare const wx: any;

export type SaveImageResult = "gallery";
export type ShareImageResult = "shared" | "canceled" | "unsupported";
export type ShareTextResult = ShareImageResult | "copied";
type WeappBlob = Blob & { __wxFilePath?: string };

const filePath = (blob: Blob) => (blob as WeappBlob).__wxFilePath || "";
const authorizeAlbum = async () => {
  const settings = await new Promise<any>((resolve, reject) => wx.getSetting({ success: resolve, fail: reject }));
  if (settings.authSetting?.["scope.writePhotosAlbum"]) return;
  await new Promise<void>((resolve, reject) => wx.authorize({ scope: "scope.writePhotosAlbum", success: () => resolve(), fail: reject }));
};
export const isNativeApp = () => true;
export async function saveImageToGallery(blob: Blob, _fileName?: string): Promise<SaveImageResult> {
  const path = filePath(blob);
  if (!path) throw new Error("图片文件尚未生成，请重新生成后保存。");
  await authorizeAlbum();
  await new Promise<void>((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: path, success: () => resolve(), fail: reject }));
  return "gallery";
}
export async function shareImage(blob: Blob, fileName: string, title: string): Promise<ShareImageResult> {
  const path = filePath(blob);
  if (!path || typeof wx.shareFileMessage !== "function") return "unsupported";
  try {
    await new Promise<void>((resolve, reject) => wx.shareFileMessage({ filePath: path, fileName, title, success: () => resolve(), fail: reject }));
    return "shared";
  } catch (error) {
    if (/cancel|abort/i.test(String((error as any)?.errMsg || ""))) return "canceled";
    throw error;
  }
}
export async function shareText(text: string): Promise<ShareTextResult> {
  await new Promise<void>((resolve, reject) => wx.setClipboardData({ data: text, success: () => resolve(), fail: reject }));
  return "copied";
}
export async function prepareWechatMomentsPost(blob: Blob, fileName?: string): Promise<SaveImageResult> {
  const result = await saveImageToGallery(blob, fileName);
  await new Promise<void>((resolve) => wx.showModal({ title: "已保存到相册", content: "请在微信朋友圈里手动选择刚保存的图片发布。", showCancel: false, success: () => resolve(), fail: () => resolve() }));
  return result;
}
