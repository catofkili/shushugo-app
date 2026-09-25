/*
 * 网页模块用到的三样浏览器全局，在小程序里的最小替身。打包时内联在 web.js 顶部。
 *  - localStorage → wx 同步存储（studyPreferences 那份偏好就存在这里，键名和网页一致）
 *    微信本地存储总量 10 MB、单键 1 MB；SQLite 学习库必须留在文件系统，不能放这里。
 *  - window.dispatchEvent / addEventListener → 进程内事件总线（PREFERENCES_EVENT、YUZU_EVENT）
 *  - Event / CustomEvent → 只带 type 和 detail 的普通对象
 *  - crypto.randomUUID → Math.random 版 v4（设备号只要求唯一，不要求密码学强度）
 *  - document.documentElement → 只有 setAttribute / removeAttribute 的空壳：applyTheme / applyMotionLevel /
 *    applyYuzuEquipment 往它上面写 data-* 属性，小程序里没人读，页面自己按 equippedItem 套皮肤。
 */
(function installPolyfill(scope) {
  if (!scope.localStorage) {
    const hasWx = typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';
    const memory = new Map();
    const registryKey = '__shushugo_local_storage_keys__';
    const keys = () => {
      if (!hasWx) return [...memory.keys()];
      try {
        const saved = wx.getStorageSync(registryKey);
        const registered = Array.isArray(saved) ? saved : [];
        const existing = wx.getStorageInfoSync?.().keys || [];
        return [...new Set([...registered, ...existing.filter((key) => key.startsWith('mn-') || key.startsWith('jp-grammar-'))])]
          .filter((key) => key !== registryKey);
      } catch { return []; }
    };
    const saveKeys = (next) => {
      if (!hasWx) return;
      wx.setStorageSync(registryKey, next);
    };
    scope.localStorage = {
      get length() { return keys().length; },
      key(index) { return keys()[Number(index)] ?? null; },
      getItem(key) {
        if (!hasWx) return memory.has(key) ? memory.get(key) : null;
        try { const value = wx.getStorageSync(key); return value === '' || value == null ? null : String(value); } catch { return null; }
      },
      setItem(key, value) {
        if (!hasWx) { memory.set(key, String(value)); return; }
        wx.setStorageSync(key, String(value));
        const current = keys();
        if (!current.includes(String(key))) saveKeys([...current, String(key)]);
      },
      removeItem(key) {
        if (!hasWx) { memory.delete(key); return; }
        wx.removeStorageSync(key);
        saveKeys(keys().filter((item) => item !== String(key)));
      },
      clear() {
        const current = keys();
        if (!hasWx) { memory.clear(); return; }
        current.forEach((key) => wx.removeStorageSync(key));
        saveKeys([]);
      }
    };
  }
  if (typeof scope.btoa !== 'function' || typeof scope.atob !== 'function') {
    const wxBase64 = typeof wx !== 'undefined' && wx;
    if (typeof scope.btoa !== 'function') scope.btoa = (value) => {
      if (wxBase64?.arrayBufferToBase64) {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
        return wx.arrayBufferToBase64(bytes.buffer);
      }
      throw new Error('Base64 编码不可用');
    };
    if (typeof scope.atob !== 'function') scope.atob = (value) => {
      if (wxBase64?.base64ToArrayBuffer) {
        const bytes = new Uint8Array(wx.base64ToArrayBuffer(value));
        let output = '';
        for (let start = 0; start < bytes.length; start += 0x8000) {
          output += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
        }
        return output;
      }
      throw new Error('Base64 解码不可用');
    };
  }
  if (typeof scope.Event !== 'function') {
    scope.Event = function Event(type) { this.type = String(type); };
    scope.CustomEvent = function CustomEvent(type, init) { this.type = String(type); this.detail = init ? init.detail : undefined; };
  }
  if (!scope.document) {
    const attributes = new Map();
    scope.document = {
      documentElement: {
        setAttribute(name, value) { attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; }
      }
    };
  }
  if (!scope.crypto || typeof scope.crypto.randomUUID !== 'function') {
    // sync/schema 的设备号用 crypto.randomUUID()；小程序运行时没有 Web Crypto。
    const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    scope.crypto = Object.assign(scope.crypto || {}, {
      randomUUID: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`
    });
  }
  if (!scope.window || typeof wx !== 'undefined') {
    const listeners = new Map();
    const eventTarget = {
      addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
      removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler)); },
      dispatchEvent(event) { (listeners.get(event.type) || []).slice().forEach((handler) => { try { handler(event); } catch (error) { console.warn('[shared] 事件回调出错', error); } }); return true; }
    };
    if (!scope.window) scope.window = eventTarget;
    scope.__shushugoWindow = eventTarget;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this));

// 微信逻辑层会在页面切换时重建全局代理；网页源码里的裸引用要抓住本模块初始化的替身。
var sharedScope = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this);
var localStorage = sharedScope.localStorage;
var window = sharedScope.__shushugoWindow || sharedScope.window;
var Event = sharedScope.Event;
var CustomEvent = sharedScope.CustomEvent;
var document = sharedScope.document;
var crypto = sharedScope.crypto;
