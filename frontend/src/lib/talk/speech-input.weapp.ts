type Failure = { errMsg?: string; errCode?: number | string };
type StopResult = { tempFilePath: string; duration?: number; fileSize?: number };
type Recorder = {
  start(options: { format: string; sampleRate: number; numberOfChannels: number; encodeBitRate: number; duration: number }): void;
  stop(): void;
  onStart(callback: () => void): void;
  onStop(callback: (result: StopResult) => void): void;
  onError(callback: (error: Failure) => void): void;
};
declare const wx: {
  getRecorderManager(): Recorder;
  authorize(options: { scope: string; success(): void; fail(error: Failure): void }): void;
  getFileSystemManager(): {
    readFile(options: { filePath: string; encoding: "base64"; success(result: { data: string | ArrayBuffer }): void; fail(error: Failure): void }): void;
  };
  cloud: { callFunction(options: { name: string; data: { audio: string; format: "mp3" } }): Promise<{ result: { text?: string; error?: string; code?: string } }> };
};

let notConfigured = false;
let recorder: Recorder | undefined;
let active: { started(): void; recorded(result: StopResult): void; failed(error: Failure): void } | undefined;
export const speechInputAvailable = (): boolean => !notConfigured && typeof wx !== "undefined" && typeof wx.getRecorderManager === "function" && Boolean(wx.cloud);

export const listen = (onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void, onStatus?: (status: "recognizing") => void): (() => void) => {
  if (!speechInputAvailable()) { onEnd(); return () => {}; }
  if (active) { onError("no-match"); onEnd(); return () => {}; }
  // 微信 2.32.3 没有 RecorderManager.off*。只注册一次，结束时清空回调，避免每张卡累积监听。
  if (!recorder) {
    try {
      const manager = wx.getRecorderManager();
      manager.onStart(() => active?.started());
      manager.onStop((result) => active?.recorded(result));
      manager.onError((error) => active?.failed(error));
      recorder = manager;
    } catch { onError("no-match"); onEnd(); return () => {}; }
  }
  const manager = recorder;
  let ended = false;
  let starting = false;
  let hasStarted = false;
  let stopped = false;
  let recognizing = false;
  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    active = undefined;
    if (error === "not-configured") notConfigured = true;
    if (error) onError(error);
    onEnd();
  };
  const failed = (error: Failure) => finish(/auth.*deny|auth.*denied/i.test(error.errMsg ?? "") ? "not-allowed" : "no-match");
  const started = () => {
    hasStarted = true;
    if (stopped) { try { manager.stop(); } catch { finish("no-match"); } }
  };
  const recorded = (result: StopResult) => {
    if (ended || recognizing) return;
    recognizing = true;
    onStatus?.("recognizing");
    if (!result.tempFilePath || result.duration === 0 || result.fileSize === 0) { finish("no-speech"); return; }
    try {
      wx.getFileSystemManager().readFile({
        filePath: result.tempFilePath, encoding: "base64",
        success: async ({ data }) => {
          if (ended) return;
          if (typeof data !== "string" || !data) { finish("no-speech"); return; }
          try {
            const { result: response } = await wx.cloud.callFunction({ name: "talk-asr", data: { audio: data, format: "mp3" } });
            if (ended) return;
            if (response?.error) {
              finish(response.error === "not_configured" ? "not-configured" : response.error === "too_long" ? "too-long" : response.error === "too_many" ? "too-many" : "no-match");
              return;
            }
            const text = typeof response?.text === "string" ? response.text.trim() : "";
            if (!text) { finish("no-speech"); return; }
            onText(text);
            finish();
          } catch (error) {
            // -501000 还包含其它云函数错误；只认明确的「函数不存在」，不要把断网永久关掉。
            const missing = /FUNCTION_NOT_(?:FOUND|EXIST)|FunctionName.*(?:not.*found|not.*exist)|function.*(?:not.*found|not.*exist)|函数.*不存在/i.test((error as Failure)?.errMsg ?? "");
            finish(missing ? "not-configured" : "no-match");
          }
        },
        fail: () => finish("no-match")
      });
    } catch { finish("no-match"); }
  };
  active = { started, recorded, failed };
  try {
    wx.authorize({
      scope: "scope.record",
      success: () => {
        if (ended) return;
        starting = true;
        try { manager.start({ format: "mp3", sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, duration: 15000 }); }
        catch { finish("no-match"); }
      },
      fail: () => finish("not-allowed")
    });
  } catch { finish("no-match"); }
  return () => {
    if (ended || stopped || recognizing) return;
    stopped = true;
    if (!starting) { finish(); return; } // 离开卡片时若权限还没回来，不得晚到后自行录音。
    if (hasStarted) { try { manager.stop(); } catch { finish("no-match"); } }
  };
};
