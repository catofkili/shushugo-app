import '../../../wechat-miniprogram/scripts/shared/polyfill.js';
import './browser-runtime.weapp.cjs';
import './fetch.weapp.cjs';
import { TaroEvent, document as taroDocument, URL as TaroURL, window as taroWindow } from '@tarojs/runtime';
import Taro from '@tarojs/taro';

const { createDownloadLink, createObjectURL, revokeObjectURL } = require('./browser-runtime.weapp.cjs') as {
  createDownloadLink: () => { href: string; download: string; click: () => void };
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

// 网页源码里的裸 window 在 Taro 里被换成 @tarojs/runtime 的 TaroWindow：addEventListener 挂在它自己的 Events 上，
// 但它没有 dispatchEvent —— 偏好、柚子、进度、同步、写盘横幅……所有 window.dispatchEvent(new Event(…)) 都会抛
// 「dispatchEvent is not a function」（2026-09-26 在柚子商店撞到；接口闸门只扫裸全局名，查不到 obj.dispatchEvent）。
// 派发到同一套 Events 上，addEventListener 注册的回调就收得到。事件名里不能有逗号（Events 按逗号拆多个事件）。
const taroEvents = taroWindow as unknown as { dispatchEvent?: (event: Event) => boolean; trigger: (type: string, event: Event) => void };
taroEvents.dispatchEvent ||= (event) => {
  taroEvents.trigger(event.type, event);
  return true;
};

const windowApis = taroWindow as unknown as {
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};
const systemInfo = wx.getSystemInfoSync();
windowApis.innerWidth ??= systemInfo.windowWidth;
windowApis.innerHeight ??= systemInfo.windowHeight;
windowApis.devicePixelRatio ??= systemInfo.pixelRatio;
windowApis.setInterval ||= (...args) => setInterval(...args);
windowApis.clearInterval ||= (timer) => clearInterval(timer);

const documentApis = taroDocument as unknown as {
  visibilityState: 'hidden' | 'visible';
  hidden: boolean;
  dispatchEvent: (event: TaroEvent) => boolean;
};
let visibilityState: 'hidden' | 'visible' = 'visible';
Object.defineProperties(documentApis, {
  visibilityState: { configurable: true, get: () => visibilityState },
  hidden: { configurable: true, get: () => visibilityState === 'hidden' }
});
const setVisibility = (next: 'hidden' | 'visible') => {
  if (visibilityState === next) return;
  visibilityState = next;
  documentApis.dispatchEvent(new TaroEvent('visibilitychange', { bubbles: false, cancelable: false }));
};
Taro.onAppShow(() => setVisibility('visible'));
Taro.onAppHide(() => setVisibility('hidden'));

if (typeof globalThis.sessionStorage === 'undefined') {
  const values = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)); },
    removeItem: (key: string) => { values.delete(String(key)); },
    clear: () => { values.clear(); }
  } as Storage;
}

if (!globalThis.performance || typeof globalThis.performance.now !== 'function') {
  globalThis.performance = Object.assign({}, globalThis.performance, { now: () => Date.now() }) as Performance;
}

// 同一个坑的另外两处：源码里的裸 URL / document 也被换成 Taro 自己的。TaroURL.createObjectURL 直接抛「not support」，
// TaroDocument.createElement('a') 是个不会下载的元素——分享图和备份导出都会坏。转给 browser-runtime.weapp.cjs 的实现。
const taroUrl = TaroURL as unknown as { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };
taroUrl.createObjectURL = createObjectURL;
taroUrl.revokeObjectURL = revokeObjectURL;
// ⚠️ 元素本身必须还是 Taro 的：React 渲染 <a> 也走 createElement，换成别的对象会 appendChild is not a function。
// 只给 <a> 补一个 click()：导出代码是 a.href = url; a.download = 名字; a.click()，从不挂进页面。
const taroCreateElement = taroDocument.createElement.bind(taroDocument);
(taroDocument as unknown as { createElement: (tag: string) => unknown }).createElement = (tag) => {
  const element = taroCreateElement(tag) as unknown as { href?: string; download?: string; click?: () => void };
  if (String(tag).toLowerCase() === 'a') {
    element.click = () => {
      const link = createDownloadLink();
      link.href = String(element.href ?? '');
      link.download = String(element.download ?? '');
      link.click();
    };
  }
  return element;
};
