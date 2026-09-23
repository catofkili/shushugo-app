// frontend/src/lib/storage.ts → 小程序落盘。persistSoon 是 debounce 语义，这里合并到下一帧。
let pending = null;
function scheduleSave() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    // 整个包起来：库可能已经被换掉 / 关掉（换设备、恢复备份、测试里 close），
    // 那时 export() 是同步抛的，不包住会变成一个没人接的定时器异常。
    try {
      Promise.resolve(require('../runtime/database-store').saveDatabase())
        .catch((error) => { if (!/尚未初始化/.test(String(error && error.message))) console.warn('[shared] 落盘失败', error); });
    } catch (error) {
      console.warn('[shared] 落盘跳过', error);
    }
  }, 300);
}
module.exports = { scheduleSave, requestFullSnapshot() {} };
