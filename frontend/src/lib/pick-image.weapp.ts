declare const wx: any;

export function pickImageDataUrl(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (result: any) => {
        const file = result.tempFiles?.[0];
        if (!file) return resolve(null);
        const extension = String(file.tempFilePath).match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
        if (!extension) return reject(new Error("无法识别图片格式"));
        const mime = extension === "jpg" ? "jpeg" : extension;
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: "base64",
          success: (read: any) => resolve(`data:image/${mime};base64,${read.data}`),
          fail: reject
        });
      },
      fail: (error: any) => {
        if (/chooseMedia:fail cancel/i.test(String(error?.errMsg ?? ""))) resolve(null);
        else reject(error);
      }
    });
  });
}
