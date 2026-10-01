import { Capacitor } from "@capacitor/core";

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
  // WKWebView 即使暴露对象也无法请求权限（WebKit 225298）；原生识别留待上线。
  const browser = window as typeof window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
};

export const speechInputAvailable = (): boolean => Boolean(recognitionType());

export const listen = (onText: (text: string) => void, onEnd: () => void, onError: (error: string) => void): (() => void) => {
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
