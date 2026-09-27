const host = typeof window === 'undefined' ? globalThis as typeof globalThis & { HTMLIFrameElement?: typeof HTMLIFrameElement } : window;

if (typeof host.HTMLIFrameElement !== 'function') {
  Object.defineProperty(host, 'HTMLIFrameElement', { value: class HTMLIFrameElement {} });
}

if (typeof document !== 'undefined' && !document.documentElement) {
  const attributes = new Map<string, string>();
  Object.defineProperty(document, 'documentElement', {
    configurable: true,
    value: {
      setAttribute: (name: string, value: string) => attributes.set(name, String(value)),
      removeAttribute: (name: string) => attributes.delete(name),
      getAttribute: (name: string) => attributes.get(name) ?? null
    }
  });
}
