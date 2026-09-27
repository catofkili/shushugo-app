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
// 用微信的「分享图片」弹窗（发送给朋友 / 分享到朋友圈 / 收藏 / 保存）：发给朋友是聊天里直接能看的图片。
// ⚠️ 别退回 shareFileMessage：那是按文件发，聊天里只看到一个 .png 附件（用户 2026-09-27 真机报的）。
// 朋友圈入口要基础库 3.8.2+，且图上不能有二维码（小程序码可以）；老版本弹窗里只是没有朋友圈那一项。
const showShareImageMenu = async (blob: Blob): Promise<ShareImageResult> => {
  const path = filePath(blob);
  if (!path || typeof wx.showShareImageMenu !== "function") return "unsupported";
  try {
    await new Promise<void>((resolve, reject) => wx.showShareImageMenu({ path, success: () => resolve(), fail: reject }));
    return "shared";
  } catch (error) {
    if (/cancel|abort/i.test(String((error as any)?.errMsg || ""))) return "canceled";
    throw error;
  }
};
export const shareMenuCoversMoments = () => true;
export async function shareImage(blob: Blob, _fileName: string, _title: string): Promise<ShareImageResult> {
  return showShareImageMenu(blob);
}
export async function shareText(text: string): Promise<ShareTextResult> {
  await new Promise<void>((resolve, reject) => wx.setClipboardData({ data: text, success: () => resolve(), fail: reject }));
  return "copied";
}
export async function prepareWechatMomentsPost(blob: Blob, fileName?: string): Promise<SaveImageResult> {
  // 小程序里界面只摆一个分享按钮（shareMenuCoversMoments），这里只在弹窗不可用时兜底：存相册再请用户手动发。
  if ((await showShareImageMenu(blob)) !== "unsupported") return "gallery";
  const result = await saveImageToGallery(blob, fileName);
  await new Promise<void>((resolve) => wx.showModal({ title: "已保存到相册", content: "请在微信朋友圈里手动选择刚保存的图片发布。", showCancel: false, success: () => resolve(), fail: () => resolve() }));
  return result;
}
