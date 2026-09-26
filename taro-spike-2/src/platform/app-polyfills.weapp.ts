import '../../../wechat-miniprogram/scripts/shared/polyfill.js';
import './browser-runtime.weapp.cjs';
import './fetch.weapp.cjs';

if (typeof globalThis.sessionStorage === 'undefined') {
  const values = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)); },
    removeItem: (key: string) => { values.delete(String(key)); },
    clear: () => { values.clear(); }
  } as Storage;
}

export const weappLocalStorage = globalThis.localStorage as Storage;
