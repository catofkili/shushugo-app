import { Image } from "@tarojs/components";
import type { CrossPlatformImageProps } from "./CrossPlatformImage";

export const CrossPlatformImage = ({ src, alt: _alt, className, style, draggable: _draggable, weappWidth, weappHeight }: CrossPlatformImageProps) => {
  const { objectFit, ...imageStyle } = style ?? {};
  return (
    <Image
      className={className}
      src={src}
      webp={/\.webp(?:[?#].*)?$/i.test(src)}
      mode={objectFit === "cover" ? "aspectFill" : "aspectFit"}
      style={{ ...imageStyle, width: weappWidth, height: weappHeight }}
    />
  );
};
