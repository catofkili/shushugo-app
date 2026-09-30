// 小程序没有系统语音，开口练习的音频又还没生成（规格 §7）：一律当放不出来，页面直接显示对方原文。
// 音频上云之后改成查例句 manifest。
export const canPlayTalkAudio = async (): Promise<boolean> => false;
