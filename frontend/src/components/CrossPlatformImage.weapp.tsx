import { Image, View } from "@tarojs/components";
import type { CrossPlatformImageProps } from "./CrossPlatformImage";

export const CrossPlatformImage = ({ src, alt: _alt, className, style, draggable: _draggable, weappWidth, weappHeight }: CrossPlatformImageProps) => {
  const { objectFit, ...imageStyle } = style ?? {};
  const isBrandIcon = className?.split(/\s+/).includes("brand-icon") && /shushugo-icon\.png(?:[?#].*)?$/i.test(src);
  if (isBrandIcon) {
    const darkSrc = src.replace(/shushugo-icon\.png(?=[?#]|$)/i, "shushugo-icon-dark.png");
    const pairStyle = { ...imageStyle, width: weappWidth, height: weappHeight };
    return <View className={`brand-icon-pair ${className ?? ""}`} style={pairStyle}>
      <Image className="brand-icon-light" src={src} mode="aspectFit" style={{ width: "100%", height: "100%" }} />
      <Image className="brand-icon-dark" src={darkSrc} mode="aspectFit" style={{ width: "100%", height: "100%" }} />
    </View>;
  }

  const networkWebp = /^(?:https?:\/\/|cloud:\/\/)/i.test(src) && /\.webp(?:[?#].*)?$/i.test(src);
  return <Image
    className={className}
    src={src}
    {...(networkWebp ? { webp: true } : {})}
    mode={objectFit === "cover" ? "aspectFill" : "aspectFit"}
    style={{ ...imageStyle, width: weappWidth, height: weappHeight }}
  />;
};
