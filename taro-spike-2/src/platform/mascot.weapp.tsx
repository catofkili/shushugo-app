import { Image, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

const brandPackages: Record<string, string[]> = {
  'empty-box': ['study'],
  'mood-ask': ['study'],
  'mood-proud': ['study', 'account'],
  'icon-study-modes': ['content-pages'],
  'icon-grammar': ['content-pages'],
  'icon-vocab': ['content-pages'],
  'icon-practice': ['content-pages'],
  'icon-kanji-readings': ['content-pages'],
  'icon-favorites': ['content-pages'],
  'icon-stats': ['content-pages'],
  'icon-shop': ['content-pages'],
  'shushugo-icon': ['content-pages']
};

const brandPath = (name: string) => {
  const route = Taro.getCurrentPages().at(-1)?.route ?? '';
  const currentPackage = route.split('/')[0];
  const packagePath = brandPackages[name]?.includes(currentPackage) ? `/${currentPackage}/assets/brand` : '/assets/brand';
  return `${packagePath}/${name}.webp`;
};

// ⚠️ 两处真机才看得出来的坑（2026-09-26 iPhone 镜像）：
// 1. 贴纸全是 .webp，小程序 <image> 不开 webp 属性时 iOS 上不显示（开发者工具是 Chrome 内核，照常显示）；
// 2. 原来是 mode="heightFix" 只给高度：图没加载出来时 <image> 默认宽 320px，一张看不见的空图把整行挤没，
//    旁边的文字只剩一个字宽、竖着排（主页问候、查词汇量标题）。固定成 size×size 的框、图在框里按比例缩放。
export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  return <Image className={`taro-spike-sticker ${className}`} src={stickerUrl(name)} webp mode="aspectFit" style={{ width: size, height: size }} />;
}

export const stickerUrl = (name: string) => brandPath(name);
export const brandAssetUrl = (path: string) => brandPath(path.split('/').at(-1)!.replace(/\.png$/, ''));
export const brandIconUrl = () => '/assets/brand/shushugo-icon.webp';
export function CapybaraWalk({ size = 55, className = '' }: { size?: number; className?: string }) {
  const width = Math.round((size * 248) / 272);
  return <View aria-hidden="true" className={`taro-spike-walk ${className}`} style={{ width: `${width}px`, height: `${size}px`, backgroundSize: `${width * 4}px ${size}px` }} />;
}
export function CapybaraMascot({ mood = 'default', size = 56, className = '' }: { mood?: string; size?: number; className?: string }) {
  return <Sticker name={`mood-${mood}`} size={size} className={className} />;
}
export function BrandIcon({ className = '' }: { className?: string }) {
  return <Image className={className} src={brandIconUrl()} webp mode="aspectFit" style={{ width: 56, height: 56 }} />;
}
export const setMascotSkin = () => undefined;
export const useMascotSkin = () => '';
