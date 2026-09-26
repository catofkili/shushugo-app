import type { CSSProperties, ImgHTMLAttributes } from "react";

export type CrossPlatformImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  weappWidth: CSSProperties["width"];
  weappHeight: CSSProperties["height"];
};

export const CrossPlatformImage = ({ src, weappWidth, weappHeight, ...props }: CrossPlatformImageProps) => {
  void weappWidth;
  void weappHeight;
  return <img src={src} {...props} />;
};
