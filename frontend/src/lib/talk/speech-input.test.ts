import { afterEach, describe, expect, it, vi } from "vitest";

const { native } = vi.hoisted(() => ({ native: vi.fn(() => false) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native } }));
import { listen, speechInputAvailable } from "./speech-input";
import * as weapp from "./speech-input.weapp";

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
  it("无 window / Recognition 和原生平台均不可用，小程序始终不可用", () => {
    vi.stubGlobal("window", undefined);
    expect(speechInputAvailable()).toBe(false);
    vi.stubGlobal("window", {});
    expect(speechInputAvailable()).toBe(false);
    vi.stubGlobal("window", { SpeechRecognition: Recognition });
    native.mockReturnValue(true);
    expect(speechInputAvailable()).toBe(false);
    const end = vi.fn();
    listen(vi.fn(), end, vi.fn())();
    expect(end).toHaveBeenCalledOnce();
    expect(weapp.speechInputAvailable()).toBe(false);
    weapp.listen(vi.fn(), end, vi.fn())();
    expect(end).toHaveBeenCalledTimes(2);
  });

  it.each(["SpeechRecognition", "webkitSpeechRecognition"])("%s 配日语、临时结果、单句；拼完整结果替换旧文，手动停后仍接收最终结果", (name) => {
    vi.stubGlobal("window", { [name]: Recognition });
    expect(speechInputAvailable()).toBe(true);
    const text = vi.fn(); const end = vi.fn();
    const stop = listen(text, end, vi.fn());
    const recognition = Recognition.latest;
    expect(recognition).toMatchObject({ lang: "ja-JP", interimResults: true, continuous: false });
    recognition.onresult!({ results: [[{ transcript: "はい" }]] });
    stop();
    stop();
    expect(recognition.stop).toHaveBeenCalledOnce();
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
