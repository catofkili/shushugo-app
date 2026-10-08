import { afterEach, beforeEach, expect, it, vi } from "vitest";

let started: () => void;
let recorded: (result: { tempFilePath: string; duration?: number; fileSize?: number }) => void;
let failed: (error: { errMsg: string }) => void;
let recorder: ReturnType<typeof makeRecorder>;
const cloud = vi.fn();
const authorize = vi.fn();
const readFile = vi.fn();
function makeRecorder() {
  return {
    start: vi.fn(() => started()), stop: vi.fn(),
    onStart: vi.fn((callback) => { started = callback; }),
    onStop: vi.fn((callback) => { recorded = callback; }),
    onError: vi.fn((callback) => { failed = callback; })
  };
}
beforeEach(() => {
  vi.resetModules();
  cloud.mockReset().mockResolvedValue({ result: { text: "はい。" } });
  authorize.mockReset().mockImplementation(({ success }) => success());
  readFile.mockReset().mockImplementation(({ success }) => success({ data: "bXAz" }));
  recorder = makeRecorder();
  vi.stubGlobal("wx", { getRecorderManager: () => recorder, authorize, getFileSystemManager: () => ({ readFile }), cloud: { callFunction: cloud } });
});
afterEach(() => vi.unstubAllGlobals());

async function begin() {
  const api = await import("./speech-input.weapp");
  const text = vi.fn(); const end = vi.fn(); const error = vi.fn(); const status = vi.fn();
  const stop = api.listen(text, end, error, status);
  return { ...api, text, end, error, status, stop };
}
async function record() {
  recorded({ tempFilePath: "/tmp/record.mp3", duration: 1200, fileSize: 7200 });
  await Promise.resolve();
  await Promise.resolve();
}

it("权限拒绝只报 not-allowed、不录音、不调用云端，结束一次", async () => {
  authorize.mockImplementation(({ fail }) => fail({ errMsg: "authorize:fail auth deny" }));
  const session = await begin();
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ scope: "scope.record" }));
  expect(session.error).toHaveBeenCalledWith("not-allowed");
  expect(session.end).toHaveBeenCalledOnce();
  expect(recorder.start).not.toHaveBeenCalled();
  expect(cloud).not.toHaveBeenCalled();
});

it.each([
  [{ text: " はい。 " }, undefined, "はい。"],
  [{ error: "not_configured" }, "not-configured", undefined],
  [{ error: "too_long" }, "too-long", undefined],
  [{ error: "too_many" }, "too-many", undefined],
  [{ error: "asr_failed", code: "FailedOperation" }, "no-match", undefined],
  [{ text: "   " }, "no-speech", undefined]
])("云函数 %j：状态先于结果、结束后清空回调", async (result, code, text) => {
  cloud.mockResolvedValue({ result });
  const session = await begin();
  expect(session.speechInputAvailable()).toBe(true);
  expect(recorder.start).toHaveBeenCalledWith({ format: "mp3", sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, duration: 15000 });
  session.stop(); session.stop();
  expect(recorder.stop).toHaveBeenCalledOnce();
  await record();
  expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/tmp/record.mp3", encoding: "base64" }));
  expect(cloud).toHaveBeenCalledWith({ name: "talk-asr", data: { audio: "bXAz", format: "mp3" } });
  expect(session.status).toHaveBeenCalledWith("recognizing");
  if (code) expect(session.error).toHaveBeenCalledWith(code);
  else {
    expect(session.error).not.toHaveBeenCalled();
    expect(session.text).toHaveBeenCalledWith(text);
    expect(session.text.mock.invocationCallOrder[0]).toBeLessThan(session.end.mock.invocationCallOrder[0]);
  }
  expect(session.end).toHaveBeenCalledOnce();
  expect(recorder.onStart).toHaveBeenCalledOnce();
  expect(recorder.onError).toHaveBeenCalledOnce();
  expect(session.speechInputAvailable()).toBe(code !== "not-configured");
  if (code === "not-configured") {
    const end = vi.fn(); session.listen(vi.fn(), end, vi.fn());
    expect(end).toHaveBeenCalledOnce();
    expect(recorder.start).toHaveBeenCalledOnce();
  }
  recorded({ tempFilePath: "/late.mp3" });
  expect(cloud).toHaveBeenCalledOnce();
});

it.each([
  ["cloud.callFunction:fail -501000 FunctionName parameter could not be found", "not-configured"],
  ["cloud.callFunction:fail network timeout", "no-match"]
])("调用失败 %s", async (errMsg, code) => {
  cloud.mockRejectedValue({ errMsg });
  const session = await begin(); await record();
  expect(session.error).toHaveBeenCalledWith(code);
  expect(session.end).toHaveBeenCalledOnce();
  expect(session.speechInputAvailable()).toBe(code !== "not-configured");
});

it("录音太短没有数据时不发云请求", async () => {
  readFile.mockImplementation(({ success }) => success({ data: "" }));
  const session = await begin(); await record();
  expect(session.error).toHaveBeenCalledWith("no-speech");
  expect(session.end).toHaveBeenCalledOnce();
  expect(cloud).not.toHaveBeenCalled();
});

it("权限尚未返回就离开时，不启动晚到的录音", async () => {
  let allow: () => void = () => {};
  authorize.mockImplementation(({ success }) => { allow = success; });
  const session = await begin(); session.stop(); allow();
  expect(recorder.start).not.toHaveBeenCalled();
  expect(session.end).toHaveBeenCalledOnce();
});

it("录音错误和文件读取失败统一 no-match", async () => {
  const session = await begin(); failed({ errMsg: "recorder:fail" });
  expect(session.error).toHaveBeenCalledWith("no-match");
  expect(session.end).toHaveBeenCalledOnce();
  readFile.mockImplementation(({ fail }) => fail({ errMsg: "readFile:fail" }));
  const second = await begin(); await record();
  expect(second.error).toHaveBeenCalledWith("no-match");
  expect(second.end).toHaveBeenCalledOnce();
  expect(recorder.onStop).toHaveBeenCalledOnce();
});

it("wx / 录音 / 云能力缺失时不可用", async () => {
  const { speechInputAvailable } = await import("./speech-input.weapp");
  vi.stubGlobal("wx", undefined); expect(speechInputAvailable()).toBe(false);
  vi.stubGlobal("wx", {}); expect(speechInputAvailable()).toBe(false);
  vi.stubGlobal("wx", { getRecorderManager() {} }); expect(speechInputAvailable()).toBe(false);
});
