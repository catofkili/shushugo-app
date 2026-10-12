import manifest from "../../data/talk_scene_images.json";

const sceneFiles: Record<string, string[]> = manifest;

export const talkSceneImageFallback = (src: string): string => src.replace(/-\d+(?=\.jpg$)/u, "");

/** 每次进入练习新建；换卡、重来、翻面和撤销都复用这一场的选图。 */
export const createTalkSceneImages = (random = Math.random) => {
  const chosen = new Map<string, string>();
  return (src: string): string => {
    const scene = /(?:^|\/)(S\d{2})(?:-\d+)?\.jpg$/u.exec(src)?.[1];
    const files = scene ? sceneFiles[scene] : undefined;
    if (!scene || !files?.length) return src;
    const file = chosen.get(scene) ?? files[Math.floor(random() * files.length)];
    chosen.set(scene, file);
    return src.replace(/[^/]+$/u, file);
  };
};
