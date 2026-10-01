export const talkImageSrc = (src: string): string => src.replace(/^\/talk\/scenes\//u, "/study/talk/scenes/");

// 原画尚未到位，小程序继续用已打包的 empty-done；原画到位后需配对添加分包 copy。
export const talkDoneImage: string | undefined = undefined;
