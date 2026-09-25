import { Image } from '@tarojs/components';

export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  return <Image className={`taro-spike-sticker ${className}`} src={stickerUrl(name)} mode="heightFix" style={{ height: size }} />;
}

export const stickerUrl = (name: string) => `/features/vocab-test/assets/brand/${name}.webp`;
export const brandIconUrl = () => '/features/vocab-test/assets/brand/shushugo-icon.webp';
export function CapybaraMascot({ mood = 'default', size = 56, className = '' }: { mood?: string; size?: number; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} />;
}
export function BrandIcon({ className = '' }: { className?: string }) {
  return <Image className={className} src={brandIconUrl()} mode="aspectFit" style={{ width: 56, height: 56 }} />;
}
export const setMascotSkin = () => undefined;
export const useMascotSkin = () => '';
