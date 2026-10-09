import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { exampleAudioName } from "../speech-audio";

const text = "お水をください。";
const localPath = (sentence = text) => `/wx-user/talk-audio/${exampleAudioName(sentence)}.aac`;
const cloudBase = "cloud://cloud1-d3g7dauie3961575b.636c-cloud1-d3g7dauie3961575b-1491634527/audio/talk/voicevox-8";
const files = new Set<string>();
const fileSystem = { access: vi.fn(), mkdir: vi.fn(), copyFile: vi.fn(), unlink: vi.fn() };
const cloud = { init: vi.fn(), getTempFileURL: vi.fn(), downloadFile: vi.fn() };
const downloadFile = vi.fn();
const createInnerAudioContext = vi.fn();
let ended: (() => void) | undefined;
let failed: (() => void) | undefined;
const context = {
  src: "", play: vi.fn(), stop: vi.fn(),
  onEnded: vi.fn((callback: () => void) => { ended = callback; }),
  onError: vi.fn((callback: () => void) => { failed = callback; }),
  offEnded: vi.fn(() => { ended = undefined; }),
  offError: vi.fn(() => { failed = undefined; })
};
let api: typeof import("./audio.weapp") | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  api = undefined;
  files.clear();
  ended = failed = undefined;
  context.src = "";
  fileSystem.access.mockImplementation(({ path, success, fail }) => {
    if (files.has(path)) success(); else fail({ errMsg: "access:fail no such file" });
  });
  fileSystem.mkdir.mockImplementation(({ success }) => success());
  fileSystem.copyFile.mockImplementation(({ destPath, success }) => { files.add(destPath); success(); });
  fileSystem.unlink.mockImplementation(({ filePath, success }) => { files.delete(filePath); success(); });
  context.onEnded.mockImplementation((callback) => { ended = callback; });
  context.onError.mockImplementation((callback) => { failed = callback; });
  context.offEnded.mockImplementation(() => { ended = undefined; });
  context.offError.mockImplementation(() => { failed = undefined; });
  createInnerAudioContext.mockReturnValue(context);
  cloud.getTempFileURL.mockImplementation(async ({ fileList }) => ({
    fileList: [{ tempFileURL: `https://temp/${encodeURIComponent(fileList[0])}` }]
  }));
  cloud.downloadFile.mockRejectedValue(new Error("cloud download failed"));
  downloadFile.mockImplementation(({ success }) => { success({ statusCode: 200, tempFilePath: "/tmp/talk.aac" }); return {}; });
  vi.stubGlobal("wx", {
    env: { USER_DATA_PATH: "/wx-user" }, cloud, downloadFile, createInnerAudioContext,
    getFileSystemManager: () => fileSystem
  });
});
afterEach(() => {
  api?.stopTalkAudio();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const load = async () => api = await import("./audio.weapp");

it("原生和 Taro 配置使用同一开口练习云存储目录", async () => {
  // @ts-expect-error 小程序 CJS 配置没有类型声明。
  const native = await import("../../../../wechat-miniprogram/src/config.js");
  // @ts-expect-error Taro CJS 配置没有类型声明。
  const taro = await import("../../../../taro-spike-2/src/platform/config.weapp.cjs");
  expect(native.default.talkAudioBaseUrl).toBe(cloudBase);
  expect(taro.default.talkAudioBaseUrl).toBe(cloudBase);
});

it("已缓存文件直接可播，不下载也不创建目录", async () => {
  files.add(localPath());
  const audio = await load();
  await expect(audio.canPlayTalkAudio(text)).resolves.toBe(true);
  expect(downloadFile).not.toHaveBeenCalled();
  expect(cloud.getTempFileURL).not.toHaveBeenCalled();
  expect(fileSystem.mkdir).not.toHaveBeenCalled();
});

it("同一哈希的并发预取只下一个 cloud 文件，保存后复用常驻缓存", async () => {
  let downloaded: (result: { statusCode: number; tempFilePath: string }) => void = () => {};
  downloadFile.mockImplementation(({ success }) => { downloaded = success; return {}; });
  const audio = await load();
  const first = audio.canPlayTalkAudio(text);
  const second = audio.canPlayTalkAudio(` ${text} `);
  await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
  expect(cloud.getTempFileURL).toHaveBeenCalledWith({ fileList: [`${cloudBase}/${exampleAudioName(text)}.aac`] });
  downloaded({ statusCode: 200, tempFilePath: "/tmp/talk.aac" });
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  expect(fileSystem.copyFile).toHaveBeenCalledWith(expect.objectContaining({ srcPath: "/tmp/talk.aac", destPath: localPath() }));
  expect(fileSystem.unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/tmp/talk.aac" }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  await expect(audio.canPlayTalkAudio(text)).resolves.toBe(true);
  expect(downloadFile).toHaveBeenCalledOnce();
  expect(files.has(localPath())).toBe(true);
  vi.useRealTimers();
});

it("未上传 / 断网返回 false 不抛，失败后仍能重新预取", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  downloadFile.mockImplementation(({ fail }) => fail({ errMsg: "downloadFile:fail offline" }));
  const audio = await load();
  await expect(audio.canPlayTalkAudio(text)).resolves.toBe(false);
  expect(cloud.downloadFile).toHaveBeenCalledWith({ fileID: `${cloudBase}/${exampleAudioName(text)}.aac` });
  expect(files.has(localPath())).toBe(false);
  downloadFile.mockImplementation(({ success }) => success({ statusCode: 200, tempFilePath: "/tmp/retry.aac" }));
  await expect(audio.canPlayTalkAudio(text)).resolves.toBe(true);
});

it("本地落盘失败返回 false，删除残留和临时文件", async () => {
  fileSystem.copyFile.mockImplementation(({ destPath, fail }) => {
    files.add(destPath); fail({ errMsg: "copyFile:fail disk full" });
  });
  const audio = await load();
  await expect(audio.canPlayTalkAudio(text)).resolves.toBe(false);
  expect(files.has(localPath())).toBe(false);
  expect(fileSystem.unlink).toHaveBeenCalledTimes(2);
});

it("没有缓存时播放直接结束，不拉网络也不用系统语音", async () => {
  const audio = await load();
  await expect(audio.playTalkAudio(text)).resolves.toBeUndefined();
  expect(downloadFile).not.toHaveBeenCalled();
  expect(createInnerAudioContext).not.toHaveBeenCalled();
});

it("stop 后晚到的下载只入缓存，不重新出声", async () => {
  let downloaded: (result: { statusCode: number; tempFilePath: string }) => void = () => {};
  downloadFile.mockImplementation(({ success }) => { downloaded = success; return {}; });
  const audio = await load();
  const prefetch = audio.canPlayTalkAudio(text);
  await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
  const playing = audio.playTalkAudio(text);
  audio.stopTalkAudio();
  downloaded({ statusCode: 200, tempFilePath: "/tmp/late.aac" });
  await expect(prefetch).resolves.toBe(true);
  await expect(playing).resolves.toBeUndefined();
  expect(context.play).not.toHaveBeenCalled();
  expect(createInnerAudioContext).not.toHaveBeenCalled();
});

it("stop 后晚到的本地文件检查不能启动旧播放", async () => {
  let found: () => void = () => {};
  fileSystem.access.mockImplementation(({ success }) => { found = success; });
  const audio = await load();
  const playing = audio.playTalkAudio(text);
  audio.stopTalkAudio();
  found();
  await expect(playing).resolves.toBeUndefined();
  expect(createInnerAudioContext).not.toHaveBeenCalled();
});

it("播放直到 ended / error 才结束，重播复用同一个 InnerAudioContext", async () => {
  files.add(localPath());
  const audio = await load();
  const resolved = vi.fn();
  const first = audio.playTalkAudio(text).then(resolved);
  await vi.waitFor(() => expect(context.play).toHaveBeenCalledOnce());
  expect(context.src).toBe(localPath());
  expect(resolved).not.toHaveBeenCalled();
  ended?.();
  await first;
  expect(resolved).toHaveBeenCalledOnce();
  const second = audio.playTalkAudio(text);
  await vi.waitFor(() => expect(context.play).toHaveBeenCalledTimes(2));
  failed?.();
  await expect(second).resolves.toBeUndefined();
  expect(createInnerAudioContext).toHaveBeenCalledOnce();
  expect(downloadFile).not.toHaveBeenCalled();
});

it("换句和 stop 都结束旧播放，晚到的旧事件不能结束新播放", async () => {
  const nextText = "ありがとうございます。";
  files.add(localPath()); files.add(localPath(nextText));
  const audio = await load();
  const first = audio.playTalkAudio(text);
  await vi.waitFor(() => expect(context.play).toHaveBeenCalledOnce());
  const oldEnded = ended;
  const resolved = vi.fn();
  const second = audio.playTalkAudio(nextText).then(resolved);
  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(context.play).toHaveBeenCalledTimes(2));
  oldEnded?.();
  expect(resolved).not.toHaveBeenCalled();
  audio.stopTalkAudio();
  await second;
  expect(resolved).toHaveBeenCalledOnce();
  expect(context.stop).toHaveBeenCalled();
  expect(ended).toBeUndefined();
  expect(failed).toBeUndefined();
});
