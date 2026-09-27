import { Image, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

const brandPackages = require('./brand-packages.cjs') as Record<string, string[]>;

const brandPath = (name: string) => {
  const route = Taro.getCurrentPages().at(-1)?.route ?? '';
  const currentPackage = route.split('/')[0];
  const packagePath = brandPackages[name]?.includes(currentPackage) ? `/${currentPackage}/assets/brand` : '/assets/brand';
  return `${packagePath}/${name}.png`;
};

// 本地 WebP 不能靠 <image webp> 在 iOS 真机显示；品牌图统一用包内 PNG。
// 固定 size×size 的框也避免未加载的图片用默认 320px 宽度挤坏相邻文字。
export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  return <Image className={`taro-spike-sticker ${className}`} src={stickerUrl(name)} mode="aspectFit" style={{ width: size, height: size }} />;
}

export const stickerUrl = (name: string) => brandPath(name);
export const brandAssetUrl = (path: string) => brandPath(path.split('/').at(-1)!.replace(/\.png$/, ''));
export const brandIconUrl = () => '/assets/brand/shushugo-icon.png';

export function CapybaraWalk({ size = 55, className = '' }: { size?: number; className?: string }) {
  const width = Math.round((size * 248) / 272);
  return <View aria-hidden="true" className={`taro-spike-walk ${className}`} style={{ width: `${width}px`, height: `${size}px` }}>
    <Image className="taro-spike-walk-strip" src={brandPath('walk-strip')} mode="scaleToFill" style={{ width: `${width * 4}px`, height: `${size}px` }} />
  </View>;
}

export function CapybaraMascot({ mood = 'default', size = 56, className = '' }: { mood?: string; size?: number; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} />;
}

export function BrandIcon({ className = '' }: { className?: string }) {
  return <View className={`brand-icon-pair ${className}`} style={{ width: 56, height: 56 }}>
    <Image className="brand-icon-light" src={brandIconUrl()} mode="aspectFit" style={{ width: '100%', height: '100%' }} />
    <Image className="brand-icon-dark" src="/assets/brand/shushugo-icon-dark.png" mode="aspectFit" style={{ width: '100%', height: '100%' }} />
  </View>;
}

export const setMascotSkin = () => undefined;
export const useMascotSkin = () => '';
