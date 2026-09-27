import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./studyPreferences", () => ({ getStudyPreferences: () => ({ voiceId: "voicevox-8" }) }));
vi.mock("./yuzu", () => ({ voiceUnlocked: () => true }));

const runtime = vi.hoisted(() => {
  const files = new Set<string>();
  const temporaryFiles = new Map<string, string | Uint8Array>();
  const listeners: { canplay?: () => void; error?: () => void } = {};
  const context = {
    src: "",
    stop: vi.fn(),
    play: vi.fn(),
    offCanplay: vi.fn(() => { listeners.canplay = undefined; }),
    offError: vi.fn(() => { listeners.error = undefined; }),
    onCanplay: vi.fn((fn: () => void) => { listeners.canplay = fn; }),
    onError: vi.fn((fn: () => void) => { listeners.error = fn; }),
    get listeners() { return listeners; }
  };
  return {
    files,
    temporaryFiles,
    context,
    downloadedIds: [] as string[],
    removedDirectory: "",
    fs: {} as Record<string, (...args: any[]) => void>,
    cloud: { init: vi.fn(), getTempFileURL: vi.fn() }
  };
});

const bytes = (value: string | Uint8Array): Uint8Array => typeof value === "string" ? new TextEncoder().encode(value) : value;

beforeEach(() => {
  runtime.files.clear();
  runtime.temporaryFiles.clear();
  runtime.downloadedIds.length = 0;
  runtime.removedDirectory = "";
  runtime.context.offCanplay();
  runtime.context.offError();
  vi.clearAllMocks();

  Object.assign(runtime.fs, {
    readdir: (options: { success: (result: { files: string[] }) => void }) => options.success({ files: ["2026-09-26"] }),
    rmdir: (options: { dirPath: string; success: () => void }) => { runtime.removedDirectory = options.dirPath; options.success(); },
    mkdir: (options: { success: () => void }) => options.success(),
    access: (options: { path: string; success: () => void; fail: (error: unknown) => void }) => (
      runtime.files.has(options.path) ? options.success() : options.fail({ errMsg: "no such file" })
    ),
    stat: (options: { path: string; success: (result: { stats: { size: number } }) => void; fail: (error: unknown) => void }) => {
      const content = runtime.temporaryFiles.get(options.path);
      return content
        ? options.success({ stats: { size: bytes(content).byteLength } })
        : options.fail({ errMsg: "no such file" });
    },
    readFile: (options: { filePath: string; success: (result: { data: ArrayBuffer }) => void; fail: (error: unknown) => void }) => {
      const content = runtime.temporaryFiles.get(options.filePath);
      if (!content) return options.fail({ errMsg: "no such file" });
      const data = bytes(content);
      return options.success({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    },
    copyFile: (options: { destPath: string; success: () => void }) => { runtime.files.add(options.destPath); options.success(); },
    unlink: (options: { filePath: string; success: () => void }) => {
      runtime.files.delete(options.filePath);
      runtime.temporaryFiles.delete(options.filePath);
      options.success();
    }
  });
  runtime.cloud.getTempFileURL.mockImplementation(async ({ fileList }: { fileList: string[] }) => ({
    fileList: [{ fileID: fileList[0], tempFileURL: `https://temp/${encodeURIComponent(fileList[0])}` }]
  }));

  vi.stubGlobal("wx", {
    env: { USER_DATA_PATH: "/wx-user" },
    cloud: runtime.cloud,
    getFileSystemManager: () => runtime.fs,
    createInnerAudioContext: () => runtime.context,
    downloadFile: ({ url, success }: { url: string; success: (result: { tempFilePath: string; statusCode: number }) => void }) => {
      const fileID = decodeURIComponent(url.replace("https://temp/", ""));
      runtime.downloadedIds.push(fileID);
      const path = `/wx-user/tmp-${runtime.downloadedIds.length}`;
      const content = fileID.endsWith("/words/index.json")
        ? JSON.stringify({ voices: [{ id: "voicevox-8", label: "声", ext: ".aac" }], default: "voicevox-8" })
        : fileID.endsWith("/examples/index.json")
          ? JSON.stringify({ voices: [{ id: "voicevox-8", label: "声", ext: ".aac" }], default: "voicevox-8" })
          : new Uint8Array([1, 2, 3]);
      runtime.temporaryFiles.set(path, content);
      success({ tempFilePath: path, statusCode: 200 });
      return {};
    }
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("小程序当天音频缓存", () => {
  it("按单词和例句顺序写入当天目录，重排时不重复下载已缓存文件", async () => {
    vi.useFakeTimers();
    const speech = await import("./speech.weapp");
    speech.prefetchWordPlanAudio([{ kanji: "灰皿", kana: "はいざら", example: "灰皿を使います。" }]);
    await vi.runAllTimersAsync();

    expect(runtime.downloadedIds.filter((id) => /\/audio\/(words|examples)\/[^/]+\/[0-9a-f]{16}\.aac$/.test(id))).toHaveLength(2);
    expect([...runtime.files].some((path) => /\/audio\/\d{4}-\d{2}-\d{2}\/words\/voicevox-8\/[0-9a-f]{16}\.aac$/.test(path))).toBe(true);
    expect([...runtime.files].some((path) => /\/audio\/\d{4}-\d{2}-\d{2}\/examples\/voicevox-8\/[0-9a-f]{16}\.aac$/.test(path))).toBe(true);
    expect(runtime.removedDirectory).toBe("/wx-user/audio/2026-09-26");

    speech.prefetchWordPlanAudio([{ kanji: "灰皿", kana: "はいざら", example: "灰皿を使います。" }]);
    await vi.runAllTimersAsync();
    expect(runtime.downloadedIds.filter((id) => /\/audio\/(words|examples)\/[^/]+\/[0-9a-f]{16}\.aac$/.test(id))).toHaveLength(2);
  });

  it("新播放开始时解开旧 Promise，只有当前播放的错误会 reject", async () => {
    const speech = await import("./speech.weapp");
    await speech.loadVoices();

    const previous = speech.playPronunciation("灰皿", "はいざら");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const current = speech.playPronunciation("箸", "はし");
    const currentRejection = expect(current).rejects.toThrow("暂不可用");
    await expect(previous).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.context.listeners.error?.();
    await currentRejection;
  });
});
