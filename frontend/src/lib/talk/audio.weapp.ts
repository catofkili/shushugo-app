// 小程序没有系统语音，开口练习的音频也放不进分包（每包 2 MB，音频约 2.5 MB）：一律当放不出来，
// 页面直接显示对方原文。音频上云之后改成按 manifest 拉云端文件（规格 §7）。
export const canPlayTalkAudio = async (_text?: string): Promise<boolean> => false;
export const playTalkAudio = async (_text: string): Promise<void> => {};
export const stopTalkAudio = (): void => {};
