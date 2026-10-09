import { exampleAudioName } from "../speech-audio";

// 小程序没有系统语音：进卡时按句子哈希从云存储预取，播放只读本地文件。
// 全量约 4.3 MB，常驻 talk-audio/，不跟单词 / 例句的每日缓存一起轮换。
// 作者上传 voicevox-8 目录前或断网下载失败时，页面仍直接显示对方原文（规格 §7）。
declare const require: (path: string) => any;
declare const wx: any;

const config = require("../../../../wechat-miniprogram/src/config.js");
const downloads = new Map<string, Promise<boolean>>();
const audioRoot = () => `${wx.env.USER_DATA_PATH}/talk-audio`;
const audioPath = (text: string) => `${audioRoot()}/${exampleAudioName(text)}.aac`;
let current: any = null;
let generation = 0;
let finishPlayback: (() => void) | null = null;

export async function canPlayTalkAudio(text = ""): Promise<boolean> {
  if (!text.trim() || typeof wx === "undefined") return false;
  try {
    // 与 speech.weapp 一样走 wx-promise：cloud:// 会转给云存储下载，返回临时文件路径。
    const { downloadFile, fileExists, makeDirectory, removeFile } = require("../../../../wechat-miniprogram/src/runtime/wx-promise.js");
    const path = audioPath(text);
    const running = downloads.get(path);
    if (running) return running;
    const task = (async () => {
      if (await fileExists(path)) return true;
      if (!config.talkAudioBaseUrl) return false;
      await makeDirectory(audioRoot());
      const temporaryPath = await downloadFile(`${config.talkAudioBaseUrl.replace(/\/$/, "")}/${exampleAudioName(text)}.aac`, { retries: 1 });
      try {
        await new Promise<void>((resolve, reject) => {
          wx.getFileSystemManager().copyFile({ srcPath: temporaryPath, destPath: path, success: () => resolve(), fail: reject });
        });
        return true;
      } catch (error) {
        await removeFile(path).catch(() => undefined);
        throw error;
      } finally {
        await removeFile(temporaryPath).catch(() => undefined);
      }
    })().catch(() => false).finally(() => downloads.delete(path));
    downloads.set(path, task);
    return task;
  } catch { return false; }
}

export function stopTalkAudio(): void {
  generation += 1;
  finishPlayback?.();
  try { current?.stop(); } catch { /* 已停或已销毁的播放器视为结束。 */ }
}

export async function playTalkAudio(text: string): Promise<void> {
  stopTalkAudio();
  if (!text.trim() || typeof wx === "undefined") return;
  const playing = generation;
  try {
    const { fileExists } = require("../../../../wechat-miniprogram/src/runtime/wx-promise.js");
    const path = audioPath(text);
    // 点播放不拉网络，也不等待在途预取；换卡 / stop 后晚到的文件检查不得重新开口。
    if (!await fileExists(path) || playing !== generation) return;
    const audio = current ??= wx.createInnerAudioContext();
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        audio.offEnded(finish);
        audio.offError(finish);
        if (finishPlayback === finish) finishPlayback = null;
        resolve();
      };
      finishPlayback = finish;
      audio.onEnded(finish);
      audio.onError(finish);
      try { audio.src = path; audio.play(); } catch { finish(); }
    });
  } catch { if (playing === generation) finishPlayback?.(); }
}
