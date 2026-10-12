import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import content from "../../data/talk_content.json";
import { createTalkSceneImages, talkSceneImageFallback } from "./scene-images";
import { talkImageSrc } from "./image-src";
import { talkImageSrc as weappImageSrc } from "./image-src.weapp";

vi.mock("../../data/talk_scene_images.json", () => ({
  default: { S07: ["S07.jpg", "S07-2.jpg", "S07-3.jpg"], S08: ["S08.jpg"] }
}));

describe("场景图变体", () => {
  it.each([[0, "S07.jpg"], [0.34, "S07-2.jpg"], [0.99, "S07-3.jpg"]])("随机值 %s 选择 %s", (value, file) => {
    expect(createTalkSceneImages(() => value)("/talk/scenes/S07.jpg")).toBe(`/talk/scenes/${file}`);
  });

  it("同一场景只抽一次；换卡或传入变体仍不换图，重新进入可重新抽", () => {
    const random = vi.fn().mockReturnValueOnce(0.34).mockReturnValue(0.99);
    const images = createTalkSceneImages(random);
    expect(images("/talk/scenes/S07.jpg")).toBe("/talk/scenes/S07-2.jpg");
    expect(images("/talk/scenes/S07.jpg")).toBe("/talk/scenes/S07-2.jpg");
    expect(images("/talk/scenes/S07-3.jpg")).toBe("/talk/scenes/S07-2.jpg");
    expect(random).toHaveBeenCalledOnce();
    expect(images("/talk/scenes/S08.jpg")).toBe("/talk/scenes/S08.jpg");
    expect(createTalkSceneImages(random)("/talk/scenes/S07.jpg")).toBe("/talk/scenes/S07-3.jpg");
  });

  it("未知图片保持原路径，变体的失败回退指向首图", () => {
    expect(createTalkSceneImages()("/talk/scenes/S99.jpg")).toBe("/talk/scenes/S99.jpg");
    expect(talkSceneImageFallback("/talk/scenes/S07-2.jpg")).toBe("/talk/scenes/S07.jpg");
    expect(talkSceneImageFallback("/talk/scenes/S07-10.jpg")).toBe("/talk/scenes/S07.jpg");
    expect(talkSceneImageFallback("/talk/scenes/S07.jpg")).toBe("/talk/scenes/S07.jpg");
  });

  it("小程序变体和首图回退使用同一云存储目录、原文件名", () => {
    const base = "cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/talk/scenes";
    expect(weappImageSrc("/talk/scenes/S07-2.jpg")).toBe(`${base}/S07-2.jpg`);
    expect(weappImageSrc(talkSceneImageFallback("/talk/scenes/S07-2.jpg"))).toBe(`${base}/S07.jpg`);
  });

  it("提交的清单与 assets 完全一致，每个内容场景的首图均存在且排第一", () => {
    const manifest: Record<string, string[]> = JSON.parse(readFileSync(new URL("../../data/talk_scene_images.json", import.meta.url), "utf8"));
    const directory = readdirSync(new URL("../../assets/talk-scenes/", import.meta.url)).filter((file) => file.endsWith(".jpg")).sort();
    expect(Object.values(manifest).flat().sort()).toEqual(directory);
    expect(Object.keys(manifest).sort()).toEqual(content.scenes.map((scene) => scene.id).sort());
    for (const [scene, files] of Object.entries(manifest)) {
      expect(files[0]).toBe(`${scene}.jpg`);
      for (const file of files) expect(talkImageSrc(`/talk/scenes/${file}`)).not.toBe(`/talk/scenes/${file}`);
    }
    execFileSync(process.execPath, [new URL("../../../scripts/build-talk-scene-images.mjs", import.meta.url).pathname, "--check"]);
  });
});
