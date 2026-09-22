// frontend/src/lib/storage.ts → 小程序落盘。persistSoon 是 debounce 语义，这里合并到下一帧。
let pending = null;
function scheduleSave() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    require('../runtime/database-store').saveDatabase().catch((error) => console.warn('[shared] 落盘失败', error));
  }, 300);
}
module.exports = { scheduleSave, requestFullSnapshot() {} };
