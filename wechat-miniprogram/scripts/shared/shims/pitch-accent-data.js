// data/pitch_accent.json（266 KiB）：网页 pitch-accent.ts 用 import() 取 `default.accents`。
// 放在 content 分包，由 src/shared/content.js 预先灌进来（app.js onLaunch 就开始拉）。
module.exports = new Proxy({}, {
  get(_target, prop) {
    const stores = require('../shared/content-store');
    if (prop === '__esModule') return false;
    if (prop === 'then') return undefined;
    if (!stores.pitchAccent) throw new Error('音高重音表还没从分包加载：先 await content.ready()');
    return prop === 'default' ? stores.pitchAccent : stores.pitchAccent[prop];
  }
});
