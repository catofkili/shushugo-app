import { Image, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useSyncExternalStore } from 'react';
import { MASCOT_SKIN_EVENT, MASCOT_SKINS } from '../../../frontend/src/lib/mascot-skins';
declare const wx: any;

const brandPackages = require('./brand-packages.cjs') as Record<string, string[]>;

const brandPath = (name: string) => {
  const route = Taro.getCurrentPages().at(-1)?.route ?? '';
  const currentPackage = route.split('/')[0];
  const packagePath = brandPackages[name]?.includes(currentPackage) ? `/${currentPackage}/assets/brand` : '/assets/brand';
  return `${packagePath}/${name}.png`;
};

const skinRoot = `${wx.env.USER_DATA_PATH}/skins`;
const cacheKeys = new Map<string, string | null>();
const manifestSkins = new Set<string>();
let skin = '';
let revision = 0;

const localSkinVersion = (id: string): string | null => {
  const sheet = MASCOT_SKINS[id as keyof typeof MASCOT_SKINS];
  if (!sheet) return null;
  if (cacheKeys.has(id)) return cacheKeys.get(id) ?? null;
  let version: string | null = null;
  try {
    const stored = wx.getStorageSync(`mn-skin-ready:${id}`);
    if (typeof stored === 'string' && stored && /^[a-zA-Z0-9._-]+$/.test(stored)) {
      const fs = wx.getFileSystemManager();
      if (sheet.names.every((name) => {
        try { fs.accessSync(`${skinRoot}/${id}/${stored}/${name}.png`); return true; } catch { return false; }
      })) version = stored;
    }
  } catch { /* 未缓存或缓存不完整时用默认水豚 */ }
  cacheKeys.set(id, version);
  return version;
};

const notifySkinChange = () => window.dispatchEvent(new Event(MASCOT_SKIN_EVENT));

window.addEventListener(MASCOT_SKIN_EVENT, () => {
  if (skin) {
    cacheKeys.delete(skin);
    localSkinVersion(skin);
  }
  revision += 1;
});

let skinCachePromise: Promise<typeof import('./mascot-skin-cache.weapp')> | null = null;
const loadSkinCache = () => skinCachePromise ??= import(
  /* webpackMode: "lazy", webpackChunkName: "lazy/mascot-skins" */ './mascot-skin-cache.weapp'
).catch((error) => { skinCachePromise = null; throw error; });

const cacheSkinInBackground = (id: string) => {
  if (!MASCOT_SKINS[id as keyof typeof MASCOT_SKINS]) return;
  void loadSkinCache().then((cache) => cache.downloadMascotSkin(id)).catch(() => undefined);
};

export const prepareMascotSkins = async (): Promise<void> => {
  try {
    const cache = await loadSkinCache();
    const manifest = await cache.prepareMascotSkins();
    manifestSkins.clear();
    Object.keys(manifest?.skins ?? {}).forEach((id) => manifestSkins.add(id));
    if (skin) cacheSkinInBackground(skin);
  } catch {
    manifestSkins.clear();
  }
};

export const setMascotSkin = (itemId: string) => {
  const changed = skin !== itemId;
  skin = itemId;
  if (changed) {
    cacheKeys.delete(itemId);
    localSkinVersion(itemId);
    notifySkinChange();
  }
  if (itemId) cacheSkinInBackground(itemId);
};

export const mascotSkinReady = (id: string) => manifestSkins.has(id) || Boolean(localSkinVersion(id));
const cachedSkinPath = (id: string, name: string) => {
  const version = localSkinVersion(id);
  return version ? `${skinRoot}/${id}/${version}/${name}.png` : null;
};

// 本地 WebP 不能靠 <image webp> 在 iOS 真机显示；品牌图统一用包内 PNG。
// 固定 size×size 的框也避免未加载的图片用默认 320px 宽度挤坏相邻文字。
export function Sticker({ name, size = 56, className = '' }: { name: string; size?: number; className?: string }) {
  const current = useMascotSkin();
  return <Image className={`taro-spike-sticker ${className}`} src={stickerUrl(name, current)} mode="aspectFit" style={{ width: size, height: size }} />;
}

export const stickerUrl = (name: string, skinId = skin) => {
  const sheet = MASCOT_SKINS[skinId as keyof typeof MASCOT_SKINS];
  if (!sheet || !localSkinVersion(skinId)) return brandPath(name);
  if ((sheet.names as readonly string[]).includes(name)) return cachedSkinPath(skinId, name)!;
  if (name.startsWith('mood-')) return cachedSkinPath(skinId, 'mood-default')!;
  return brandPath(name);
};
export const brandAssetUrl = (path: string) => brandPath(path.split('/').at(-1)!.replace(/\.png$/, ''));
export const brandIconUrl = (skinId = skin) => {
  const sheet = MASCOT_SKINS[skinId as keyof typeof MASCOT_SKINS];
  return sheet && localSkinVersion(skinId) ? cachedSkinPath(skinId, 'app-icon')! : '/assets/brand/shushugo-icon.png';
};

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
  const current = useMascotSkin();
  return <View className={`brand-icon-pair ${className}`} style={{ width: 56, height: 56 }}>
    <Image className="brand-icon-light" src={brandIconUrl(current)} mode="aspectFit" style={{ width: '100%', height: '100%' }} />
    <Image className="brand-icon-dark" src="/assets/brand/shushugo-icon-dark.png" mode="aspectFit" style={{ width: '100%', height: '100%' }} />
  </View>;
}

const subscribe = (callback: () => void) => {
  window.addEventListener(MASCOT_SKIN_EVENT, callback);
  return () => window.removeEventListener(MASCOT_SKIN_EVENT, callback);
};
const skinSnapshot = () => `${skin}\u0000${revision}`;
export const useMascotSkin = () => {
  useSyncExternalStore(subscribe, skinSnapshot, () => '');
  return skin;
};
