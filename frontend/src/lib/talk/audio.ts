// 网页 / iOS：开口练习的句子还没有预生成音频（规格 §7），playExample 会退回系统语音，有系统语音就能播。
export const canPlayTalkAudio = async (): Promise<boolean> =>
  typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function";
