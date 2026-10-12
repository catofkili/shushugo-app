// 包含首图和全部变体；由开口练习的懒加载路由引用，文件 URL 交给 Vite 带哈希打包。
const scenes = import.meta.glob("../../assets/talk-scenes/*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export { createTalkSceneImages, talkSceneImageFallback } from "./scene-images";

export const talkImageSrc = (src: string): string =>
  scenes[`../../assets/talk-scenes/${src.split("/").pop()}`] ?? src;

const art = import.meta.glob("../../assets/talk-art/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export const talkDoneImage: string | undefined = art["../../assets/talk-art/talk-done.png"];
export const talkHeroImage: string | undefined = art["../../assets/talk-art/talk-hero.png"];
