import { useEffect, useState } from "react";
import { Image, View, type ImageProps } from "@tarojs/components";
import type { CrossPlatformImageProps } from "./CrossPlatformImage";

declare const wx: any;

let cachedAvatarDataUrl = "";
let cachedAvatarPath: Promise<string> | null = null;
let avatarWriteQueue: Promise<unknown> = Promise.resolve();

function localAvatarPath(dataUrl: string): Promise<string> {
  if (dataUrl === cachedAvatarDataUrl && cachedAvatarPath) return cachedAvatarPath;
  const match = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(dataUrl);
  if (!match) return Promise.reject(new Error("头像数据格式无效"));
  const subtype = match[1].toLowerCase();
  const extension = (subtype === "jpeg" ? "jpg" : subtype === "svg+xml" ? "svg" : subtype).replace(/[^a-z0-9]/g, "") || "img";
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 16777619);
  const path = `${wx.env.USER_DATA_PATH}/avatar-${(hash >>> 0).toString(16)}.${extension}`;
  // 微信 <image> 文档没有承诺 data URL 可用；写入 USER_DATA_PATH 后用本地文件路径显示，资料/云同步仍保留 data URL。
  const write = avatarWriteQueue.catch(() => undefined).then(() => new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: match[2],
      encoding: "base64",
      success: () => resolve(path),
      fail: reject
    });
  }));
  avatarWriteQueue = write;
  cachedAvatarDataUrl = dataUrl;
  cachedAvatarPath = write;
  return write;
}

export const CrossPlatformImage = ({ src, alt: _alt, className, style, draggable: _draggable, weappWidth, weappHeight, onError }: CrossPlatformImageProps) => {
  const [resolvedAvatar, setResolvedAvatar] = useState({ source: "", path: "" });
  const isDataUrl = src.startsWith("data:image/");
  useEffect(() => {
    if (!isDataUrl) return;
    let active = true;
    void localAvatarPath(src).then((path) => {
      if (active) setResolvedAvatar({ source: src, path });
    }).catch((error) => console.error("Failed to write avatar image:", error));
    return () => { active = false; };
  }, [isDataUrl, src]);

  const { objectFit, ...imageStyle } = style ?? {};
  const imageError = onError as unknown as ImageProps["onError"];
  const isBrandIcon = className?.split(/\s+/).includes("brand-icon") && /shushugo-icon\.png(?:[?#].*)?$/i.test(src);
  if (isBrandIcon) {
    const darkSrc = src.replace(/shushugo-icon\.png(?=[?#]|$)/i, "shushugo-icon-dark.png");
    const pairStyle = { ...imageStyle, width: weappWidth, height: weappHeight };
    return <View className={`brand-icon-pair ${className ?? ""}`} style={pairStyle}>
      <Image className="brand-icon-light" src={src} mode="aspectFit" style={{ width: "100%", height: "100%" }} onError={imageError} />
      <Image className="brand-icon-dark" src={darkSrc} mode="aspectFit" style={{ width: "100%", height: "100%" }} onError={imageError} />
    </View>;
  }

  const networkWebp = /^(?:https?:\/\/|cloud:\/\/)/i.test(src) && /\.webp(?:[?#].*)?$/i.test(src);
  return <Image
    className={className}
    src={isDataUrl ? (resolvedAvatar.source === src ? resolvedAvatar.path : "") : src}
    {...(networkWebp ? { webp: true } : {})}
    mode={objectFit === "cover" ? "aspectFill" : "aspectFit"}
    onError={imageError}
    style={{ ...imageStyle, width: weappWidth, height: weappHeight }}
  />;
};
