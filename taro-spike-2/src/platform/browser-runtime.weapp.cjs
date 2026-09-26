const listeners = new Map();
const windowTarget = globalThis.window || globalThis.__shushugoWindow || globalThis;
windowTarget.addEventListener ||= (type, listener) => {
  const entries = listeners.get(type) || [];
  entries.push(listener); listeners.set(type, entries);
};
windowTarget.removeEventListener ||= (type, listener) => listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
windowTarget.dispatchEvent ||= (event) => {
  (listeners.get(event.type) || []).slice().forEach((listener) => listener(event));
  return true;
};
windowTarget.setTimeout ||= setTimeout.bind(globalThis);
windowTarget.clearTimeout ||= clearTimeout.bind(globalThis);

const documentTarget = globalThis.document || (globalThis.document = {});
if (!('visibilityState' in documentTarget)) {
  Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', configurable: true });
}
documentTarget.addEventListener ||= (type, listener) => {
  const entries = listeners.get(`document:${type}`) || [];
  entries.push(listener); listeners.set(`document:${type}`, entries);
};
documentTarget.removeEventListener ||= (type, listener) => listeners.set(`document:${type}`, (listeners.get(`document:${type}`) || []).filter((item) => item !== listener));

module.exports = {};
