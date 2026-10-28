// 五十音读音（小程序）。Taro 构建把 frontend/src/assets/kana-audio 拷到 study 分包的 kana-audio/（taro-spike-2/config/index.js），
// 五十音卡只在 study 分包的备考页上，包内路径直接播，不下载。
declare const wx: any;
let context: any;

export const playKanaSound = (sound: string): void => {
  context ??= wx.createInnerAudioContext();
  const src = `/study/kana-audio/${sound}.aac`;
  context.stop();
  // 同一个 src 再赋一次值不会重新加载（2026-10-18 那次「一直重放第一个词」就是这个），同一条就 stop 后从头放。
  if (context.src !== src) context.src = src;
  context.play();
};
