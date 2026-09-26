import '../../../wechat-miniprogram/scripts/shared/polyfill.js';
import './browser-runtime.weapp.cjs';
import './fetch.weapp.cjs';
import { window as taroWindow } from '@tarojs/runtime';

// 网页源码里的裸 window 在 Taro 里被换成 @tarojs/runtime 的 TaroWindow：addEventListener 挂在它自己的 Events 上，
// 但它没有 dispatchEvent —— 偏好、柚子、进度、同步、写盘横幅……所有 window.dispatchEvent(new Event(…)) 都会抛
// 「dispatchEvent is not a function」（2026-09-26 在柚子商店撞到；接口闸门只扫裸全局名，查不到 obj.dispatchEvent）。
// 派发到同一套 Events 上，addEventListener 注册的回调就收得到。事件名里不能有逗号（Events 按逗号拆多个事件）。
const taroEvents = taroWindow as unknown as { dispatchEvent?: (event: Event) => boolean; trigger: (type: string, event: Event) => void };
taroEvents.dispatchEvent ||= (event) => {
  taroEvents.trigger(event.type, event);
  return true;
};

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

export const weappLocalStorage = globalThis.localStorage as Storage;
