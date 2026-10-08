import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

const nativeIos = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
const iosSpeechRecognition = async () => (await import("@capacitor-community/speech-recognition")).SpeechRecognition;

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

const recognitionType = () => {
  if (Capacitor.isNativePlatform() || typeof window === "undefined") return undefined;
  // WKWebView 即使暴露对象也无法请求权限（WebKit 225298）；iOS 原生走下面的插件。
  const browser = window as typeof window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
};

export const speechInputAvailable = (): boolean | Promise<boolean> => nativeIos()
  ? iosSpeechRecognition().then((plugin) => plugin.available()).then((result) => result.available).catch(() => false)
  : Boolean(recognitionType());

const listenIos = (onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void): (() => void) => {
  let plugin: Awaited<ReturnType<typeof iosSpeechRecognition>> | undefined;
  const listeners: PluginListenerHandle[] = [];
  let ended = false;
  let stopped = false;
  let started = false;
  let hasText = false;
  const removeListeners = () => {
    for (const listener of listeners.splice(0)) void listener.remove().catch(() => {});
  };
  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    removeListeners();
    if (error || !hasText) onError(error ?? "no-speech");
    onEnd();
  };
  const receiveText = (matches: string[]) => {
    if (ended || !matches[0]?.trim()) return;
    hasText = true;
    onText(matches[0]);
  };
  void (async () => {
    try {
      plugin = await iosSpeechRecognition();
      if (ended) return;
      const permission = await plugin.checkPermissions();
      if (ended) return;
      // 6.0.1 的 iOS checkPermissions 只查 SFSpeechRecognizer；即使 granted 也要经
      // requestPermissions 检查/请求麦克风，不能只信 definitions.d.ts 的合并权限说明。
      if (permission.speechRecognition === "denied") { finish("not-allowed"); return; }
      const requested = await plugin.requestPermissions();
      if (ended) return;
      if (requested.speechRecognition !== "granted") { finish("not-allowed"); return; }
      listeners.push(await plugin.addListener("partialResults", ({ matches }) => receiveText(matches)));
      if (ended) { removeListeners(); return; }
      listeners.push(await plugin.addListener("listeningState", ({ status }) => {
        if (status === "stopped") finish();
      }));
      if (ended) { removeListeners(); return; }
      const result = await plugin.start({ language: "ja-JP", partialResults: true, popup: false });
      started = true;
      // stop 若发生在原生 start 的异步启动期间，等它真正启动再停，避免后台继续录音。
      if (stopped) { void plugin.stop().catch(() => {}); return; }
      if (ended) return;
      receiveText(result.matches ?? []);
      // partialResults 模式下 start 在开始录音时就 resolve；确认已停才把 promise 当结束。
      if (!(await plugin.isListening()).listening) finish();
    } catch (error) {
      if (ended) return;
      if (started) void plugin?.stop().catch(() => {});
      const message = (error as { message?: string } | null)?.message ?? String(error);
      finish(/permission|denied|restricted/i.test(message) ? "not-allowed" : "unknown");
    }
  })();
  return () => {
    if (ended) return;
    stopped = true;
    if (started) void plugin?.stop().catch(() => {});
    finish();
  };
};

export const listen = (onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void, _onStatus?: (status: "recognizing") => void): (() => void) => {
  if (nativeIos()) return listenIos(onText, onEnd, onError);
  const Constructor = recognitionType();
  if (!Constructor) { onEnd(); return () => {}; }
  let recognition: Recognition | undefined;
  let ended = false;
  let stopped = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    if (recognition) recognition.onresult = recognition.onend = recognition.onerror = null;
    onEnd();
  };
  try {
    recognition = new Constructor();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => onText(Array.from(event.results, (result) => result[0]?.transcript ?? "").join(""));
    recognition.onend = finish;
    recognition.onerror = (event) => { onError(event.error); finish(); };
    recognition.start();
  } catch (error) {
    onError(error instanceof Error && error.name === "NotAllowedError" ? "not-allowed" : "unknown");
    finish();
  }
  return () => {
    if (ended || stopped) return;
    stopped = true;
    try { recognition?.stop(); } catch { finish(); }
  };
};
