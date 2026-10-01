// 场景图故意不放 public/：Vite 会把 public/ 整个拷进产物，开关关着也会带上。
// 由这里引用，只有开口练习的代码块引到它们，关着开关一张都不进包。
const scenes = import.meta.glob("../../assets/talk-scenes/*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export const talkImageSrc = (src: string): string =>
  scenes[`../../assets/talk-scenes/${src.split("/").pop()}`] ?? src;
