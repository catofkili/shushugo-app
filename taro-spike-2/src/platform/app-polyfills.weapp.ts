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
const systemInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
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

// WXML omits aria-* and nearly all data-* attributes. CSS selectors based on
// those attributes therefore need equivalent runtime classes on TaroElement.
type AttributeSelector = {
  attribute: string;
  operator: string;
  value: string;
  insensitive: boolean;
  className: string;
};
const attributeSelectors = JSON.parse(process.env.TARO_ATTRIBUTE_SELECTORS || '[]') as AttributeSelector[];
if (attributeSelectors.length) {
  const sample = taroDocument.createElement('view') as unknown as object;
  const elementPrototype = Object.getPrototypeOf(sample) as {
    setAttribute: (name: string, value: unknown) => void;
    removeAttribute: (name: string) => void;
    getAttribute: (name: string) => unknown;
    hasAttribute: (name: string) => boolean;
  };
  const setAttribute = elementPrototype.setAttribute;
  const removeAttribute = elementPrototype.removeAttribute;
  const selectorsByAttribute = new Map<string, AttributeSelector[]>();
  for (const selector of attributeSelectors) {
    const group = selectorsByAttribute.get(selector.attribute) ?? [];
    group.push(selector);
    selectorsByAttribute.set(selector.attribute, group);
  }
  const previousClasses = new WeakMap<object, Map<string, Set<string>>>();
  const matchesAttribute = (element: typeof sample, selector: AttributeSelector) => {
    if (!elementPrototype.hasAttribute.call(element, selector.attribute)) return false;
    const raw = selector.attribute === 'class'
      ? String(elementPrototype.getAttribute.call(element, 'class') || '').split(/\s+/)
        .filter((name) => ![...(previousClasses.get(element)?.values() ?? [])].some((group) => group.has(name))).join(' ')
      : String(elementPrototype.getAttribute.call(element, selector.attribute));
    const value = selector.insensitive ? raw.toLowerCase() : raw;
    const expected = selector.insensitive ? selector.value.toLowerCase() : selector.value;
    switch (selector.operator) {
      case '=': return value === expected;
      case '!=': return value !== expected;
      case '~=': return value.split(/\s+/).includes(expected);
      case '|=': return value === expected || value.startsWith(`${expected}-`);
      case '^=': return value.startsWith(expected);
      case '$=': return value.endsWith(expected);
      case '*=': return value.includes(expected);
      default: return true;
    }
  };
  const syncSelectorClasses = (element: typeof sample, changedAttribute: string) => {
    const previous = previousClasses.get(element) ?? new Map<string, Set<string>>();
    const classes = String(elementPrototype.getAttribute.call(element, 'class') || '')
      .split(/\s+/).filter(Boolean).filter((name) => ![...previous.values()].some((group) => group.has(name)));
    const next = new Map(previous);
    const affected = changedAttribute === 'class' ? ['class']
      : changedAttribute === 'style' || changedAttribute === '__hmStyle' ? ['style']
      : [changedAttribute];
    for (const name of affected) {
      const group = new Set<string>();
      for (const selector of selectorsByAttribute.get(name) ?? []) {
        if (matchesAttribute(element, selector)) group.add(selector.className);
      }
      next.set(name, group);
    }
    const derived = new Set<string>();
    next.forEach((group) => group.forEach((name) => derived.add(name)));
    classes.push(...derived);
    const className = [...new Set(classes)].join(' ');
    if (String(elementPrototype.getAttribute.call(element, 'class') || '') !== className) {
      setAttribute.call(element, 'class', className);
    }
    previousClasses.set(element, next);
  };
  elementPrototype.setAttribute = function (name, value) {
    setAttribute.call(this, name, value);
    if (name === 'class' || name === 'style' || name === '__hmStyle' || selectorsByAttribute.has(name)) {
      syncSelectorClasses(this as typeof sample, name);
    }
  };
  elementPrototype.removeAttribute = function (name) {
    removeAttribute.call(this, name);
    if (name === 'class' || name === 'style' || name === '__hmStyle' || selectorsByAttribute.has(name)) {
      syncSelectorClasses(this as typeof sample, name);
    }
  };
}

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
