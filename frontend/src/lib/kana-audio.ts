// 五十音读音（网页 / iOS）。文件由 scripts/build-kana-audio.mjs 生成、随包发，不走云端音频包，线上网页也有声音。
const clips = import.meta.glob("../assets/kana-audio/*.aac", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
let player: HTMLAudioElement | undefined;

export const playKanaSound = (sound: string): void => {
  const url = clips[`../assets/kana-audio/${sound}.aac`];
  if (!url) return;
  player ??= new Audio();
  player.pause();
  player.src = url;
  // 自动播放被浏览器拦下就算了，卡上有喇叭按钮可以再点
  void player.play().catch(() => undefined);
};
