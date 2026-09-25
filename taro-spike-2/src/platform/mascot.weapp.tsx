import { Image, View } from '@tarojs/components';

export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  return <Image className={`taro-spike-sticker ${className}`} src={stickerUrl(name)} mode="heightFix" style={{ height: size }} />;
}

export const stickerUrl = (name: string) => `/assets/brand/${name}.webp`;
export const brandIconUrl = () => '/assets/brand/shushugo-icon.webp';
export function CapybaraWalk({ size = 55, className = '' }: { size?: number; className?: string }) {
  const width = Math.round((size * 248) / 272);
  return <View aria-hidden="true" className={`taro-spike-walk ${className}`} style={{ width: `${width}px`, height: `${size}px`, backgroundSize: `${width * 4}px ${size}px` }} />;
}
export function CapybaraMascot({ mood = 'default', size = 56, className = '' }: { mood?: string; size?: number; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} />;
}
export function BrandIcon({ className = '' }: { className?: string }) {
  return <Image className={className} src={brandIconUrl()} mode="aspectFit" style={{ width: 56, height: 56 }} />;
}
export const setMascotSkin = () => undefined;
export const useMascotSkin = () => '';
