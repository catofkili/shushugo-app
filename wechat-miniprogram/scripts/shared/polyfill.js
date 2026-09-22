/*
 * 网页模块用到的三样浏览器全局，在小程序里的最小替身。打包时内联在 web.js 顶部。
 *  - localStorage → wx 同步存储（studyPreferences 那份偏好就存在这里，键名和网页一致）
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
    scope.localStorage = {
      getItem(key) {
        if (!hasWx) return memory.has(key) ? memory.get(key) : null;
        try { const value = wx.getStorageSync(key); return value === '' || value == null ? null : String(value); } catch { return null; }
      },
      setItem(key, value) {
        if (!hasWx) { memory.set(key, String(value)); return; }
        try { wx.setStorageSync(key, String(value)); } catch { /* 存储满了：偏好丢一次不致命 */ }
      },
      removeItem(key) {
        if (!hasWx) { memory.delete(key); return; }
        try { wx.removeStorageSync(key); } catch { /* 同上 */ }
      }
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
  if (!scope.window) {
    const listeners = new Map();
    scope.window = {
      addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
      removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler)); },
      dispatchEvent(event) { (listeners.get(event.type) || []).slice().forEach((handler) => { try { handler(event); } catch (error) { console.warn('[shared] 事件回调出错', error); } }); return true; }
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this));
