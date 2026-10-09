import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { native, platform, pluginLoaded, plugin } = vi.hoisted(() => ({
  native: vi.fn(() => false),
  platform: vi.fn(() => "web"),
  pluginLoaded: vi.fn(),
  plugin: {
    available: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn(),
    start: vi.fn(), stop: vi.fn(), isListening: vi.fn(), addListener: vi.fn()
  }
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native, getPlatform: platform } }));
vi.mock("@capacitor-community/speech-recognition", () => {
  pluginLoaded();
  return { SpeechRecognition: plugin };
});
import { listen, speechInputAvailable } from "./speech-input";

const callbacks = new Map<string, (data: { matches: string[] } | { status: "started" | "stopped" }) => void>();
const removals: ReturnType<typeof vi.fn>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  native.mockReturnValue(false);
  platform.mockReturnValue("web");
  callbacks.clear();
  removals.length = 0;
  plugin.available.mockResolvedValue({ available: true });
  plugin.checkPermissions.mockResolvedValue({ speechRecognition: "granted" });
  plugin.requestPermissions.mockResolvedValue({ speechRecognition: "granted" });
  plugin.start.mockResolvedValue({});
  plugin.stop.mockResolvedValue(undefined);
  plugin.isListening.mockResolvedValue({ listening: true });
  plugin.addListener.mockImplementation(async (name, callback) => {
    callbacks.set(name, callback);
    const remove = vi.fn(async () => { callbacks.delete(name); });
    removals.push(remove);
    return { remove };
  });
});

class Recognition {
  static latest: Recognition;
  lang = "";
  interimResults = false;
  continuous = true;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() { Recognition.latest = this; }
}

afterEach(() => { vi.unstubAllGlobals(); native.mockReset(); native.mockReturnValue(false); });

describe("浏览器识别只转写", () => {
  it("网页不加载原生插件；无 window / Recognition 和 Android 原生仍不可用", () => {
    vi.stubGlobal("window", undefined);
    expect(speechInputAvailable()).toBe(false);
    vi.stubGlobal("window", {});
    expect(speechInputAvailable()).toBe(false);
    vi.stubGlobal("window", { SpeechRecognition: Recognition });
    expect(speechInputAvailable()).toBe(true);
    const webEnd = vi.fn();
    listen(vi.fn(), webEnd, vi.fn())();
    Recognition.latest.onend!();
    expect(webEnd).toHaveBeenCalledOnce();
    platform.mockReturnValue("android");
    native.mockReturnValue(true);
    expect(speechInputAvailable()).toBe(false);
    const end = vi.fn();
    listen(vi.fn(), end, vi.fn())();
    expect(end).toHaveBeenCalledOnce();
    expect(pluginLoaded).not.toHaveBeenCalled();
    expect(plugin.available).not.toHaveBeenCalled();
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it.each(["SpeechRecognition", "webkitSpeechRecognition"])("%s 配日语、临时结果、单句；拼完整结果替换旧文，手动停后仍接收最终结果", (name) => {
    vi.stubGlobal("window", { [name]: Recognition });
    expect(speechInputAvailable()).toBe(true);
    const text = vi.fn(); const end = vi.fn(); const status = vi.fn();
    const stop = listen(text, end, vi.fn(), status);
    const recognition = Recognition.latest;
    expect(recognition).toMatchObject({ lang: "ja-JP", interimResults: true, continuous: false });
    recognition.onresult!({ results: [[{ transcript: "はい" }]] });
    stop();
    stop();
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    recognition.onresult!({ results: [[{ transcript: "はい、" }], [{ transcript: "お願いします。" }]] });
    expect(text.mock.calls).toEqual([["はい"], ["はい、お願いします。"]]);
    recognition.onend!();
    expect(end).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
    stop();
    expect(recognition.stop).toHaveBeenCalledOnce();
  });

  it.each(["not-allowed", "service-not-allowed", "no-speech", "network"])("%s 结束并清理回调，晚到的 end 不重复通知", (reason) => {
    vi.stubGlobal("window", { SpeechRecognition: Recognition });
    const error = vi.fn(); const end = vi.fn();
    listen(vi.fn(), end, error);
    const recognition = Recognition.latest;
    const lateEnd = recognition.onend!;
    recognition.onerror!({ error: reason });
    lateEnd();
    expect(error).toHaveBeenCalledWith(reason);
    expect(end).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
  });

  it("start 同步拒绝也能结束，不把失败的实例留作活动监听", () => {
    class Denied extends Recognition {
      start = vi.fn(() => { throw new DOMException("denied", "NotAllowedError"); });
    }
    vi.stubGlobal("window", { SpeechRecognition: Denied });
    const error = vi.fn(); const end = vi.fn();
    listen(vi.fn(), end, error)();
    expect(error).toHaveBeenCalledWith("not-allowed");
    expect(end).toHaveBeenCalledOnce();
    expect(Recognition.latest.onresult).toBeNull();
  });
});

describe("iOS 原生识别只转写", () => {
  beforeEach(() => { native.mockReturnValue(true); platform.mockReturnValue("ios"); });
  const ready = async () => {
    await vi.waitFor(() => expect(plugin.isListening).toHaveBeenCalledOnce());
  };

  it("可用性取插件 available，不依赖 WKWebView 暴露的识别对象", async () => {
    vi.stubGlobal("window", undefined);
    expect(await speechInputAvailable()).toBe(true);
    plugin.available.mockResolvedValueOnce({ available: false });
    expect(await speechInputAvailable()).toBe(false);
    plugin.available.mockRejectedValueOnce(new Error("plugin unavailable"));
    expect(await speechInputAvailable()).toBe(false);
  });

  it.each([
    ["denied", "denied"], ["prompt", "denied"], ["granted", "denied"]
  ])("检查 %s / 请求 %s 拒权限，包括已授语音但麦克风拒绝，不启动", async (checked, requested) => {
    plugin.checkPermissions.mockResolvedValueOnce({ speechRecognition: checked });
    plugin.requestPermissions.mockResolvedValueOnce({ speechRecognition: requested });
    const error = vi.fn(); const end = vi.fn();
    const stop = listen(vi.fn(), end, error);
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(error).toHaveBeenCalledExactlyOnceWith("not-allowed");
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(checked === "denied" ? 0 : 1);
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
    stop();
    expect(end).toHaveBeenCalledOnce();
  });

  it("配置日语单句；start 的启动确认不结束；部分结果只显示第一候选", async () => {
    const text = vi.fn(); const error = vi.fn(); const end = vi.fn(); const status = vi.fn();
    listen(text, end, error, status);
    await ready();
    expect(plugin.requestPermissions).toHaveBeenCalledOnce();
    expect(plugin.start).toHaveBeenCalledExactlyOnceWith({ language: "ja-JP", partialResults: true, popup: false });
    expect(end).not.toHaveBeenCalled();
    callbacks.get("listeningState")!({ status: "started" });
    callbacks.get("partialResults")!({ matches: ["こんにちは", "こんばんは"] });
    callbacks.get("partialResults")!({ matches: [] });
    callbacks.get("partialResults")!({ matches: ["こんにちは。"] });
    callbacks.get("listeningState")!({ status: "stopped" });
    expect(text.mock.calls).toEqual([["こんにちは"], ["こんにちは。"]]);
    expect(end).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled(); // 同网页版：没有录完后等待云识别的阶段。
    expect(removals).toHaveLength(2);
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });

  it.each(["stopped", "promise"])("无结果经 %s 结束，只报一次 no-speech", async (ending) => {
    if (ending === "promise") plugin.isListening.mockResolvedValueOnce({ listening: false });
    const error = vi.fn(); const end = vi.fn();
    const stop = listen(vi.fn(), end, error);
    await ready();
    if (ending === "stopped") {
      callbacks.get("partialResults")!({ matches: ["   "] });
      const lateEnd = callbacks.get("listeningState")!;
      lateEnd({ status: "stopped" });
      lateEnd({ status: "stopped" });
    }
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(error).toHaveBeenCalledExactlyOnceWith("no-speech");
    stop();
    expect(plugin.stop).not.toHaveBeenCalled();
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });

  it("start promise 已结束且返回文字时也能转发并完成", async () => {
    plugin.start.mockResolvedValueOnce({ matches: ["はい", "いいえ"] });
    plugin.isListening.mockResolvedValueOnce({ listening: false });
    const text = vi.fn(); const error = vi.fn(); const end = vi.fn();
    listen(text, end, error);
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(text).toHaveBeenCalledExactlyOnceWith("はい");
    expect(error).not.toHaveBeenCalled();
  });

  it("stop 幂等、清理各自监听，忽略晚到回调；原生 stop 拒绝也不泄漏", async () => {
    plugin.stop.mockRejectedValueOnce(new Error("already stopped"));
    const text = vi.fn(); const error = vi.fn(); const end = vi.fn(); const status = vi.fn();
    const stop = listen(text, end, error, status);
    await ready();
    const lateText = callbacks.get("partialResults")!;
    const lateEnd = callbacks.get("listeningState")!;
    lateText({ matches: ["はい"] });
    stop(); stop();
    lateText({ matches: ["遅い結果"] });
    lateEnd({ status: "stopped" });
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledOnce());
    expect(text).toHaveBeenCalledExactlyOnceWith("はい");
    expect(error).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });

  it("权限请求期间取消，晚到的授权不会启动录音", async () => {
    let grant!: (value: { speechRecognition: string }) => void;
    plugin.requestPermissions.mockReturnValueOnce(new Promise((resolve) => { grant = resolve; }));
    const error = vi.fn(); const end = vi.fn();
    const stop = listen(vi.fn(), end, error);
    await vi.waitFor(() => expect(plugin.requestPermissions).toHaveBeenCalledOnce());
    stop(); stop();
    grant({ speechRecognition: "granted" });
    await Promise.resolve();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith("no-speech");
    expect(end).toHaveBeenCalledOnce();
  });

  it("监听注册期间取消，晚到的 handle 也会移除", async () => {
    let attach!: (value: { remove: ReturnType<typeof vi.fn> }) => void;
    const remove = vi.fn().mockResolvedValue(undefined);
    plugin.addListener.mockReturnValueOnce(new Promise((resolve) => { attach = resolve; }));
    const end = vi.fn();
    const stop = listen(vi.fn(), end, vi.fn());
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalledOnce());
    stop();
    attach({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.addListener).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });

  it("原生 start 尚未确认时取消，等启动确认后只停一次", async () => {
    let acknowledge!: (value: object) => void;
    plugin.start.mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve; }));
    const end = vi.fn();
    const stop = listen(vi.fn(), end, vi.fn());
    await vi.waitFor(() => expect(plugin.start).toHaveBeenCalledOnce());
    stop(); stop();
    acknowledge({});
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledOnce());
    expect(end).toHaveBeenCalledOnce();
    expect(plugin.isListening).not.toHaveBeenCalled();
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });

  it.each([
    ["User denied access to microphone", "not-allowed"], ["network unavailable", "unknown"]
  ])("原生 start 拒绝 %s → %s，结束且清理监听", async (message, code) => {
    plugin.start.mockRejectedValueOnce(new Error(message));
    const error = vi.fn(); const end = vi.fn();
    listen(vi.fn(), end, error);
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(error).toHaveBeenCalledExactlyOnceWith(code);
    expect(callbacks.size).toBe(0);
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });
});
