import { Text, View } from '@tarojs/components';

export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  return <View className={`taro-spike-sticker ${className}`} style={{ width: size, height: size }}><Text>🦫</Text></View>;
}

export const stickerUrl = (name: string) => `/brand/sheet/${name}.png`;
export const brandIconUrl = () => '/brand/shushugo-icon.png';
export function CapybaraMascot({ mood = 'default', size = 56, className = '' }: { mood?: string; size?: number; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} />;
}
export function BrandIcon({ className = '' }: { className?: string }) {
  return <Sticker name="logo-lockup" size={56} className={className} />;
}
export const setMascotSkin = () => undefined;
export const useMascotSkin = () => '';
