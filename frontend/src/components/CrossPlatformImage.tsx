import type { CSSProperties, ImgHTMLAttributes } from "react";

export type CrossPlatformImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  weappWidth: CSSProperties["width"];
  weappHeight: CSSProperties["height"];
};

export const CrossPlatformImage = ({ src, weappWidth, weappHeight, className, style, alt = "", ...props }: CrossPlatformImageProps) => {
  void weappWidth;
  void weappHeight;
  const isBrandIcon = className?.split(/\s+/).includes("brand-icon") && /shushugo-icon\.png(?:[?#].*)?$/i.test(src);
  if (!isBrandIcon) return <img src={src} className={className} style={style} alt={alt} {...props} />;
  const darkSrc = src.replace(/shushugo-icon\.png(?=[?#]|$)/i, "shushugo-icon-dark.png");
  return <span className={`brand-icon-pair ${className}`} style={style}>
    <img className="brand-icon-light" src={src} alt={alt} />
    <img className="brand-icon-dark" src={darkSrc} alt={alt} />
  </span>;
};
