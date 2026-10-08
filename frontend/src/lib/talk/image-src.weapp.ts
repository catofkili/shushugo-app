declare const require: (path: string) => any;
const { talkSceneBaseUrl } = require("../../../../wechat-miniprogram/src/config.js");

export const talkImageSrc = (src: string): string => `${talkSceneBaseUrl}/${src.replace(/^.*\//u, "")}`;

// 两张插画由 taro-spike-2/config/index.js 的 copy 规则（只在开关打开时）拷进 study/talk/art/。
export const talkDoneImage: string | undefined = "/study/talk/art/talk-done.png";
export const talkHeroImage: string | undefined = "/study/talk/art/talk-hero.png";
